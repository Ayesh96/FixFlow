#!/usr/bin/env python3
"""Drives the terminal setup wizard (scripts/setup.mjs) in a pseudo-terminal.

Covers section T of desktop/tests/CASES.md. Prints `PASS <id>` or `FAIL <id>: <why>` per case.

Each case runs in a fresh scratch copy of scripts/, server/ and package.json, with node_modules
symlinked, so the wizard writes only to the scratch copy. HOME is also pointed at the scratch
copy, so the default ~/.fixflow is never created. A fake Ollama, DeepSeek and Anthropic run in
this process, and the busy-port cases hold real listening sockets. The real repo .env is only
checksummed before and after the run (case GUARD).

Usage: python3 test/setup-wizard.pty.py      (macOS or Linux, with node on PATH)
"""
import contextlib
import hashlib
import http.server
import json
import os
import pty
import re
import select
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REAL_ENV = REPO / '.env'
CTRL_D = '\x04'
GOOD_KEY = 'sk-good'
OLLAMA_MODELS = ['qwen2.5-coder:7b', 'llama3.2:3b']
DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner']
ANTHROPIC_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-5']
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][0-9A-Za-z]|\x1b[=>]|\x1b\][^\x07]*\x07')

STATE = {'ollama': 'ok'}  # ok | empty | error, read by the fake Ollama


class Fail(Exception):
    pass


# ---- fake services ---------------------------------------------------------------------------

def ollama_routes(path, headers):
    if path != '/api/tags':
        return 404, {}
    mode = STATE['ollama']
    if mode == 'error':
        return 500, {'error': 'boom'}
    if mode == 'empty':
        return 200, {'models': []}
    return 200, {'models': [{'name': m} for m in OLLAMA_MODELS]}


def deepseek_routes(path, headers):
    if path != '/models':
        return 404, {}
    if not (headers.get('Authorization') or '').startswith(f'Bearer {GOOD_KEY}'):
        return 401, {'error': {'message': 'Authentication Fails'}}
    return 200, {'object': 'list', 'data': [{'id': m, 'object': 'model'} for m in DEEPSEEK_MODELS]}


def anthropic_routes(path, headers):
    if path != '/v1/models':
        return 404, {}
    if not (headers.get('x-api-key') or '').startswith('sk-ant-good'):
        return 401, {'error': {'message': 'invalid x-api-key'}}
    return 200, {'data': [{'id': m, 'type': 'model'} for m in ANTHROPIC_MODELS]}


def start_server(routes):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            code, body = routes(self.path, self.headers)
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


# ---- scratch copy ----------------------------------------------------------------------------

def make_scratch(env_bytes=None):
    d = Path(tempfile.mkdtemp(prefix='fixflow-setup-'))
    shutil.copytree(REPO / 'scripts', d / 'scripts', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(REPO / 'server', d / 'server', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy(REPO / 'package.json', d / 'package.json')
    (d / 'node_modules').symlink_to(REPO / 'node_modules')
    (d / 'home').mkdir()
    if env_bytes is not None:
        (d / '.env').write_bytes(env_bytes)
    return d


# ---- pty driver ------------------------------------------------------------------------------

class Run:
    def __init__(self, rc, text, sent, unsent, timed_out, stuck):
        self.rc, self.text, self.sent, self.unsent = rc, text, sent, unsent
        self.timed_out, self.stuck = timed_out, stuck

    def status(self):
        """None when the wizard exited on its own; otherwise why it did not."""
        if self.timed_out:
            return 'timed out waiting for the wizard'
        if self.stuck:
            return f'wizard is waiting at a prompt with no answer left ({self.text.rsplit(chr(10), 1)[-1]!r})'
        if self.unsent:
            return f'wizard exited before these answers were used: {[a for _, a in self.unsent]}'
        return None


def clean(s):
    return ANSI.sub('', s).replace('\r', '')


def run_wizard(scratch, steps, env_extra=None, timeout=60.0):
    """steps: [(prompt_pattern, answer)]. Each answer is sent when the output ends with a prompt
    (matching the pattern, or any prompt after 0.3s of quiet). CTRL_D is sent as a raw Ctrl+D."""
    env = dict(os.environ)
    env.update(env_extra or {})
    env['HOME'] = str(scratch / 'home')
    env['TERM'] = 'xterm'
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.chdir(scratch)
            os.execvpe('node', ['node', 'scripts/setup.mjs'], env)
        except Exception:
            pass
        os._exit(127)

    parts, queue, sent = [], list(steps), []
    pending = ''
    start = last_out = time.time()
    timed_out = stuck = False
    while True:
        if time.time() - start > timeout:
            timed_out = True
            break
        ready, _, _ = select.select([fd], [], [], 0.05)
        if ready:
            try:
                data = os.read(fd, 65536)
            except OSError:  # EIO once the child closes the terminal
                data = b''
            if not data:
                break
            chunk = clean(data.decode('utf-8', 'replace'))
            parts.append(chunk)
            pending += chunk
            last_out = time.time()
        last_line = pending.rsplit('\n', 1)[-1]
        looks_prompt = last_line.endswith(' ') and last_line.strip() != ''
        quiet = time.time() - last_out
        if queue and looks_prompt:
            pat, ans = queue[0]
            if re.search(pat, last_line) or quiet >= 0.3:
                os.write(fd, CTRL_D.encode() if ans == CTRL_D else (ans + '\r').encode())
                sent.append((pat, ans))
                queue.pop(0)
                pending = ''
                last_out = time.time()
        elif not queue and looks_prompt and quiet >= 1.5:
            stuck = True
            break

    if timed_out or stuck:
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGKILL)
    rc = None
    deadline = time.time() + 5
    while True:
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            break
        if wpid == pid:
            rc = os.waitstatus_to_exitcode(status)
            break
        if time.time() > deadline:
            with contextlib.suppress(ProcessLookupError):
                os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            break
        time.sleep(0.05)
    with contextlib.suppress(OSError):
        os.close(fd)
    return Run(rc, ''.join(parts), sent, queue, timed_out, stuck)


# ---- helpers for checks ----------------------------------------------------------------------

def read_env(scratch):
    p = scratch / '.env'
    if not p.exists():
        return None
    out = {}
    for line in p.read_text().splitlines():
        if line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        out[k.strip()] = v.strip()
    return out


def need(cond, why):
    if not cond:
        raise Fail(why)


def need_finished(run):
    why = run.status()
    if why:
        raise Fail(why)


def need_in_order(text, parts):
    pos = 0
    for p in parts:
        i = text.find(p, pos)
        if i < 0:
            raise Fail(f'expected {p!r} after the earlier output; not found')
        pos = i + len(p)


def need_env(scratch, key, value):
    env = read_env(scratch)
    need(env is not None, 'no .env was written')
    need(env.get(key) == value, f'{key} is {env.get(key)!r}, expected {value!r}')


def need_commented(scratch, key):
    p = scratch / '.env'
    need(p.exists(), 'no .env was written')
    need(f'# {key}=' in p.read_text(), f'{key} is not left out (commented) in .env')


# ---- step lists (prompt pattern matches the last line of the prompt) -------------------------

def start_steps(data, dash):
    return [('Dashboard port', str(dash)), ('Data folder', str(data))]


def ollama_ok_steps(url):
    return [('Set up Ollama', 'y'), ('Ollama URL', url), ('Choice', '')]


HOSTED_NO = [('Set up DeepSeek', 'n'), ('Set up Anthropic', 'n')]


def errors_resolver_steps(ing, thresholds=('',), level=''):
    steps = [('Ingest port', str(ing)), ('Choice', ''), ('sentry_key', ''), ('Labels applied', ''), ('Choice', level), ]
    steps += [('Event counts', t) for t in thresholds]
    steps += [('Days to keep', ''), ('Choice', ''), ('Max fixes running', ''), ('Max attempts', ''), ('Retry SKIPPED', '')]
    return steps


class Ctx:
    def __init__(self, scratch, dash, ing, ollama_url, deepseek_url, anthropic_url):
        self.scratch, self.dash, self.ing = scratch, dash, ing
        self.ollama_url, self.deepseek_url, self.anthropic_url = ollama_url, deepseek_url, anthropic_url
        self.data = scratch / 'data'

    def run(self, steps, timeout=60.0):
        env = {'ORCH_DEEPSEEK_API_URL': self.deepseek_url, 'ORCH_ANTHROPIC_API_URL': self.anthropic_url}
        return run_wizard(self.scratch, steps, env, timeout)

    def happy_steps(self):
        return start_steps(self.data, self.dash) + ollama_ok_steps(self.ollama_url) + HOSTED_NO + errors_resolver_steps(self.ing)


@contextlib.contextmanager
def case_ctx(env_bytes=None, ollama_state='ok'):
    scratch = make_scratch(env_bytes)
    ollama_srv, ollama_url = start_server(ollama_routes)
    deepseek_srv, deepseek_url = start_server(deepseek_routes)
    anthropic_srv, anthropic_url = start_server(anthropic_routes)
    STATE['ollama'] = ollama_state
    dash, ing = free_port(), free_port()
    while ing == dash:
        ing = free_port()
    ctx = Ctx(scratch, dash, ing, ollama_url, deepseek_url, anthropic_url)
    keep = False
    try:
        yield ctx
    except Fail:
        keep = True
        raise
    finally:
        STATE['ollama'] = 'ok'
        for srv in (ollama_srv, deepseek_srv, anthropic_srv):
            srv.shutdown()
            srv.server_close()
        if not keep:
            shutil.rmtree(scratch, ignore_errors=True)


# ---- cases -----------------------------------------------------------------------------------

def case_T1():
    scratch = make_scratch()
    try:
        proc = subprocess.run(['node', 'scripts/setup.mjs'], cwd=scratch, input=b'\n',
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
                              env={**os.environ, 'HOME': str(scratch / 'home')})
        need(proc.returncode == 1, f'exit code {proc.returncode}, expected 1')
        need(b'Setup needs an interactive terminal' in proc.stderr, 'no "needs an interactive terminal" message on stderr')
        need(not (scratch / '.env').exists(), '.env was written')
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def case_T2():
    with case_ctx() as c:
        run = c.run(start_steps(c.data, c.dash) + [('Set up Ollama', 'y'), ('Ollama URL', CTRL_D)])
        need('Setup cancelled. Nothing was written.' in run.text, 'no "Setup cancelled" message after Ctrl+D')
        need(run.rc == 1, f'exit code {run.rc}, expected 1')
        need(read_env(c.scratch) is None, '.env was written')


def case_T3():
    original = b'PORT=9999\n# keep me\n'
    with case_ctx(env_bytes=original) as c:
        run = c.run([('Overwrite it', 'n')])
        need_finished(run)
        need('Keeping the existing .env' in run.text, 'no "Keeping the existing .env" message')
        need(run.rc == 0, f'exit code {run.rc}, expected 0')
        need((c.scratch / '.env').read_bytes() == original, '.env changed although the answer was No')


def case_T4():
    busy_srv = socket.socket()
    busy_srv.bind(('127.0.0.1', 0))
    busy_srv.listen(1)
    busy = busy_srv.getsockname()[1]
    try:
        with case_ctx() as c:
            steps = [('Dashboard port', '0'), ('Dashboard port', 'abc'), ('Dashboard port', str(busy)),
                     ('Dashboard port', str(c.dash))]
            steps += start_steps(c.data, c.dash)[1:] + ollama_ok_steps(c.ollama_url) + HOSTED_NO + errors_resolver_steps(c.ing)
            run = c.run(steps)
            need_finished(run)
            need_in_order(run.text, [
                'Dashboard port', 'Please enter a port number from 1 to 65535.',
                'Dashboard port', 'Please enter a port number from 1 to 65535.',
                'Dashboard port', f'Port {busy} is already in use',
                'Dashboard port', 'Data folder',
            ])
    finally:
        busy_srv.close()


def case_T5():
    with case_ctx() as c:
        steps = start_steps(c.data, c.dash) + ollama_ok_steps(c.ollama_url) + HOSTED_NO
        steps += [('Ingest port', str(c.dash)), ('Ingest port', str(c.ing))] + errors_resolver_steps(c.ing)[1:]
        run = c.run(steps)
        need_finished(run)
        need_in_order(run.text, ['Ingest port', f'That is the dashboard port ({c.dash}). Pick a different one.', 'Ingest port'])


def case_T6():
    with case_ctx() as c:
        steps = start_steps(c.data, c.dash) + [('Set up Ollama', 'n'), ('Set up DeepSeek', 'n'), ('Set up Anthropic', 'n')]
        steps += ollama_ok_steps(c.ollama_url) + HOSTED_NO + errors_resolver_steps(c.ing)
        run = c.run(steps)
        need_finished(run)
        need_in_order(run.text, ['Set up Ollama', 'Set up at least one model; the resolver needs one to write fixes.', 'Set up Ollama'])
        need_env(c.scratch, 'ORCH_LLM_PROVIDERS', 'ollama')


def case_T7():
    with case_ctx() as c:
        dead = f'http://127.0.0.1:{free_port()}'
        steps = start_steps(c.data, c.dash) + [('Set up Ollama', 'y'), ('Ollama URL', dead), ('Choice', '1'),
                                              ('Ollama URL', c.ollama_url), ('Choice', '')]
        steps += HOSTED_NO + errors_resolver_steps(c.ing)
        run = c.run(steps)
        need_finished(run)
        need_in_order(run.text, ['Could not reach Ollama at', 'What now?', 'Enter the Ollama address again', 'Turn Ollama off', 'Ollama URL'])
        need_env(c.scratch, 'ORCH_OLLAMA_URL', c.ollama_url)


def turn_ollama_off_steps(c, url):
    return (start_steps(c.data, c.dash) + [('Set up Ollama', 'y'), ('Ollama URL', url), ('Choice', '2'),
                                          ('Set up DeepSeek', 'y'), ('DeepSeek API key', GOOD_KEY), ('Choice', ''),
                                          ('Set up Anthropic', 'n')] + errors_resolver_steps(c.ing))


def case_T7b():
    with case_ctx() as c:
        dead = f'http://127.0.0.1:{free_port()}'
        run = c.run(turn_ollama_off_steps(c, dead))
        need_finished(run)
        need_in_order(run.text, ['Could not reach Ollama at', 'What now?', 'Turn Ollama off'])
        need_commented(c.scratch, 'ORCH_OLLAMA_URL')
        need_env(c.scratch, 'ORCH_LLM_PROVIDERS', 'deepseek')


def case_T7c():
    with case_ctx(ollama_state='empty') as c:
        run = c.run(turn_ollama_off_steps(c, c.ollama_url))
        need_finished(run)
        need_in_order(run.text, ['has no models yet', 'ollama pull qwen2.5-coder:7b', 'What now?', 'Turn Ollama off'])
        need_commented(c.scratch, 'ORCH_OLLAMA_URL')


def case_T8():
    with case_ctx() as c:
        steps = start_steps(c.data, c.dash) + ollama_ok_steps(c.ollama_url)
        steps += [('Set up DeepSeek', 'y'), ('DeepSeek API key', 'sk-bad'), ('DeepSeek API key', ''),
                  ('Set up Anthropic', 'n')] + errors_resolver_steps(c.ing)
        run = c.run(steps)
        need_finished(run)
        need_in_order(run.text, ['DeepSeek API key', 'DeepSeek rejected that key', 'DeepSeek API key', 'No key entered — skipping DeepSeek.'])
        need_env(c.scratch, 'ORCH_LLM_PROVIDERS', 'ollama')
        need_commented(c.scratch, 'ORCH_DEEPSEEK_API_KEY')


def case_T9():
    with case_ctx() as c:
        steps = start_steps(c.data, c.dash) + ollama_ok_steps(c.ollama_url) + HOSTED_NO
        steps += errors_resolver_steps(c.ing, thresholds=('1', '100,1000'))
        run = c.run(steps)
        need_finished(run)
        need_in_order(run.text, ['Event counts', 'Enter counts as a comma-separated list', 'Event counts'])
        need_env(c.scratch, 'ORCH_ERRORS_COMMENT_THRESHOLDS', '100,1000')


def case_T10():
    with case_ctx() as c:
        run = c.run(c.happy_steps())
        need_finished(run)
        need('Enable error tracking?' not in run.text, 'the wizard asked "Enable error tracking?"')
        need('Enable the resolver?' not in run.text, 'the wizard asked "Enable the resolver?"')
        need_env(c.scratch, 'ORCH_ERRORS_ENABLED', '1')
        need_env(c.scratch, 'ORCH_RESOLVER_ENABLED', '1')


LOAD_CONFIG_JS = r'''
import { readFileSync } from 'node:fs';
import { loadConfig } from './server/config.ts';
const env = {};
for (const raw of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); const eq = l.indexOf('=');
  if (!l || l.startsWith('#') || eq < 0) continue;
  env[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
}
loadConfig(env);
console.log('loadConfig ok');
'''


def case_T11():
    with case_ctx() as c:
        run = c.run(c.happy_steps())
        need_finished(run)
        need(run.rc == 0, f'exit code {run.rc}, expected 0')
        need('Wrote ' in run.text, 'no "Wrote" message')
        need_env(c.scratch, 'PORT', str(c.dash))
        need_env(c.scratch, 'ORCH_LLM_PROVIDERS', 'ollama')
        need_env(c.scratch, 'ORCH_OLLAMA_URL', c.ollama_url)
        need_env(c.scratch, 'ORCH_OLLAMA_MODEL', OLLAMA_MODELS[0])
        need_env(c.scratch, 'ORCH_ERRORS_INGEST_PORT', str(c.ing))
        proc = subprocess.run(['node', '--input-type=module', '-e', LOAD_CONFIG_JS], cwd=c.scratch,
                              capture_output=True, text=True, timeout=60)
        need(proc.returncode == 0 and 'loadConfig ok' in proc.stdout,
             f'server loadConfig rejected the .env: {(proc.stderr or proc.stdout).strip()[-300:]}')


# A complete .env with every setting set to a non-default value, so the edit cases can
# tell whether each prompt really defaults to what the file says.
EDIT_FIXTURE = '''PORT={dash}
ORCH_DATA_DIR={data}
ORCH_LLM_PROVIDERS=anthropic,deepseek,ollama
ORCH_OLLAMA_URL={ollama}
ORCH_OLLAMA_MODEL=llama3.2:3b
ORCH_DEEPSEEK_API_KEY=sk-good-KEEP1234
ORCH_DEEPSEEK_MODEL=deepseek-reasoner
ORCH_ANTHROPIC_API_KEY=sk-ant-good-ABCD
ORCH_ANTHROPIC_MODEL=claude-sonnet-4-5
ORCH_ERRORS_ENABLED=1
ORCH_ERRORS_INGEST_PORT={ing}
ORCH_ERRORS_INGEST_HOST=0.0.0.0
ORCH_ERRORS_DSN_PUBLIC_KEY=access-KEY-5678
ORCH_ERRORS_GITHUB_LABELS=bug,sentry,prod
ORCH_ERRORS_MIN_LEVEL=warning
ORCH_ERRORS_COMMENT_THRESHOLDS=50,500
ORCH_ERRORS_RETENTION_DAYS=14
ORCH_RESOLVER_ENABLED=1
ORCH_RESOLVER_POLL_INTERVAL_MS=900000
ORCH_RESOLVER_MAX_CONCURRENT_FIXES=2
ORCH_RESOLVER_MAX_ATTEMPTS=5
ORCH_RESOLVER_RETRY_SKIPPED_ATTEMPTS=1
'''


def write_edit_fixture(c):
    (c.scratch / '.env').write_text(EDIT_FIXTURE.format(dash=c.dash, ing=c.ing, data=c.data, ollama=c.ollama_url))
    return read_env(c.scratch)


def hold_port(port):
    """A listening socket, so the port is busy the way a running FixFlow server would leave it."""
    s = socket.socket()
    s.bind(('127.0.0.1', port))
    s.listen(1)
    return s


def edit_steps(c, max_fixes=''):
    """Answers Enter to every question (Overwrite: y). max_fixes overrides the one answer."""
    return [
        ('Overwrite it', 'y'),
        ('Dashboard port', ''), ('Data folder', ''),
        ('Set up Ollama', ''), ('Ollama URL', ''), ('Choice', ''),
        ('Set up DeepSeek', ''), ('DeepSeek API key', ''), ('Choice', ''),
        ('Set up Anthropic', ''), ('Anthropic API key', ''), ('Choice', ''),
        ('Order to try them in', ''),
        ('Ingest port', ''), ('Choice', ''), ('sentry_key', ''), ('Labels applied', ''), ('Choice', ''),
        ('Event counts', ''), ('Days to keep', ''), ('Choice', ''),
        ('Max fixes running', max_fixes), ('Max attempts', ''), ('Retry SKIPPED', ''),
    ]


def diff_env(before, after):
    return {k: (before.get(k), after.get(k)) for k in set(before) | set(after) if before.get(k) != after.get(k)}


def case_E1():
    with case_ctx() as c:
        before = write_edit_fixture(c)
        held = [hold_port(c.dash), hold_port(c.ing)]  # the running server holds both ports
        try:
            run = c.run(edit_steps(c))
        finally:
            for s in held:
                s.close()
        need_finished(run)
        need(run.rc == 0, f'exit code {run.rc}, expected 0')
        need('editing the existing settings' in run.text, 'heading does not say the settings are being edited')
        need('is already in use' not in run.text, 'a port the existing .env already uses was reported busy')
        need_in_order(run.text, ['Lowest level filed on GitHub', 'Choice [3]'])
        after = read_env(c.scratch)
        need(after == before, f'values changed after pressing Enter on every question: {diff_env(before, after)}')


def case_E2():
    with case_ctx() as c:
        before = write_edit_fixture(c)
        held = [hold_port(c.dash), hold_port(c.ing)]
        try:
            run = c.run(edit_steps(c, max_fixes='4'))
        finally:
            for s in held:
                s.close()
        need_finished(run)
        need(run.rc == 0, f'exit code {run.rc}, expected 0')
        changed = diff_env(before, read_env(c.scratch))
        need(changed == {'ORCH_RESOLVER_MAX_CONCURRENT_FIXES': ('2', '4')},
             f'changed values were {changed}, expected only ORCH_RESOLVER_MAX_CONCURRENT_FIXES 2 -> 4')


def case_E3():
    with case_ctx() as c:
        before = write_edit_fixture(c)
        held = [hold_port(c.dash), hold_port(c.ing)]
        try:
            run = c.run(edit_steps(c))
        finally:
            for s in held:
                s.close()
        need_finished(run)
        for mask in ('[••••1234]', '[••••ABCD]', '[••••5678]'):
            need(mask in run.text, f'masked key {mask} was not shown')
        for secret in ('sk-good-KEEP1234', 'sk-ant-good-ABCD', 'access-KEY-5678'):
            need(secret not in run.text, 'a stored key was printed in full')
        need(read_env(c.scratch) == before, 'a stored key was lost on a blank answer')


def case_L1():
    with case_ctx() as c:
        run = c.run(start_steps(c.data, c.dash) + ollama_ok_steps(c.ollama_url) + HOSTED_NO
                    + errors_resolver_steps(c.ing, level='3'))
        need_finished(run)
        need_in_order(run.text, [
            'Lowest level filed on GitHub',
            '1) Crashes only (fatal)',
            '2) Errors and crashes (error, fatal)',
            '3) Warnings too (warning, error, fatal)',
            '4) Info too (info, warning, error, fatal)',
            '5) Everything (debug and up)',
            'Choice [2]',
        ])
        need_env(c.scratch, 'ORCH_ERRORS_MIN_LEVEL', 'warning')


CASES = [
    ('T1', case_T1), ('T2', case_T2), ('T3', case_T3), ('T4', case_T4), ('T5', case_T5),
    ('T6', case_T6), ('T7', case_T7), ('T7b', case_T7b), ('T7c', case_T7c), ('T8', case_T8),
    ('T9', case_T9), ('T10', case_T10), ('T11', case_T11),
    ('E1', case_E1), ('E2', case_E2), ('E3', case_E3), ('L1', case_L1),
]


def digest(path):
    return hashlib.md5(path.read_bytes()).hexdigest() if path.exists() else 'absent'


def main():
    before = digest(REAL_ENV)
    failures = 0
    for cid, fn in CASES:
        try:
            fn()
            print(f'PASS {cid}', flush=True)
        except Fail as e:
            failures += 1
            print(f'FAIL {cid}: {e}', flush=True)
        except Exception as e:  # harness problem, reported as a failure of that case
            failures += 1
            print(f'FAIL {cid}: harness error: {e!r}', flush=True)
    after = digest(REAL_ENV)
    if before == after:
        print('PASS GUARD', flush=True)
    else:
        failures += 1
        print(f'FAIL GUARD: repo .env changed ({before} -> {after})', flush=True)
    print(f'{len(CASES) + 1 - failures} passed, {failures} failed', flush=True)


if __name__ == '__main__':
    main()
