import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  resolveInWorkDir,
  readFileTool,
  listDirectoryTool,
  grepTool,
  editFileTool,
  executeTool,
  ToolPathError,
  TOOL_DEFINITIONS,
} from '../../../server/workflows/resolver/agent-tools.ts';

describe('agent-tools', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tools-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('resolveInWorkDir - path containment', () => {
    it('resolves a simple relative path inside cwd', () => {
      const result = resolveInWorkDir(tempDir, 'src/index.ts');
      assert.ok(result.startsWith(tempDir));
      assert.ok(result.endsWith(path.join('src', 'index.ts')));
    });

    it('resolves . to cwd itself', () => {
      const result = resolveInWorkDir(tempDir, '.');
      assert.equal(result, tempDir);
    });

    it('rejects a traversal attempt like ../../../etc/passwd', () => {
      assert.throws(
        () => resolveInWorkDir(tempDir, '../../../etc/passwd'),
        ToolPathError
      );
    });

    it('rejects a nested traversal that escapes cwd like foo/../../bar', () => {
      assert.throws(
        () => resolveInWorkDir(tempDir, 'foo/../../bar'),
        ToolPathError
      );
    });

    it('rejects an absolute path outside cwd', () => {
      assert.throws(
        () => resolveInWorkDir(tempDir, '/etc/passwd'),
        ToolPathError
      );
    });

    it('correctly uses path separator to prevent prefix escapes', () => {
      // Test that the implementation uses sep in the check, preventing a prefix-only match
      // If cwd is /tmp/foo, a path resolving to /tmp/foobar should be rejected
      const relPath = '../' + path.basename(tempDir) + 'bar';
      assert.throws(
        () => resolveInWorkDir(tempDir, relPath),
        ToolPathError,
        'path with similar prefix but outside cwd should be rejected'
      );
    });

    it('resolves nested relative paths correctly', () => {
      const result = resolveInWorkDir(tempDir, 'a/b/c/file.txt');
      assert.ok(result.includes('a'));
      assert.ok(result.includes('b'));
      assert.ok(result.includes('c'));
      assert.ok(result.includes('file.txt'));
    });
  });

  describe('readFileTool', () => {
    it('reads back exactly what was written to a file', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      const content = 'Hello, World!\nLine 2';
      await fs.writeFile(testFile, content, 'utf8');

      const result = await readFileTool(tempDir, 'test.txt');
      assert.equal(result, content);
    });

    it('rejects (throws) for a file that does not exist', async () => {
      await assert.rejects(
        () => readFileTool(tempDir, 'nonexistent.txt'),
        /ENOENT/
      );
    });

    it('rejects via ToolPathError for a path that escapes cwd', async () => {
      // Create a file just outside tempDir
      const parentDir = path.dirname(tempDir);
      const outsideFile = path.join(parentDir, 'outside.txt');
      await fs.writeFile(outsideFile, 'outside content', 'utf8');

      try {
        await assert.rejects(
          () => readFileTool(tempDir, '../outside.txt'),
          ToolPathError
        );
      } finally {
        await fs.rm(outsideFile, { force: true });
      }
    });

    it('returns a truncation message for a file larger than MAX_FILE_STAT_BYTES (200KB)', async () => {
      const testFile = path.join(tempDir, 'large.txt');
      // Create a file larger than 200KB (200_000 bytes)
      const largeContent = 'x'.repeat(200_001);
      await fs.writeFile(testFile, largeContent, 'utf8');

      const result = await readFileTool(tempDir, 'large.txt');
      assert.match(result, /file too large to read/);
      assert.ok(!result.includes('x'.repeat(1000)), 'should not contain large content');
    });

    it('returns content with (truncated) marker for a file larger than MAX_READ_BYTES (100KB)', async () => {
      const testFile = path.join(tempDir, 'medium.txt');
      // Create a file larger than 100KB but smaller than 200KB
      const content = 'a'.repeat(50_000) + '\n' + 'b'.repeat(60_000);
      await fs.writeFile(testFile, content, 'utf8');

      const result = await readFileTool(tempDir, 'medium.txt');
      assert.match(result, /\.\.\.\(truncated\)/);
      assert.ok(result.length < content.length, 'result should be shorter than original');
    });

    it('returns "is not a file" message for a directory', async () => {
      const testDir = path.join(tempDir, 'subdir');
      await fs.mkdir(testDir);

      const result = await readFileTool(tempDir, 'subdir');
      assert.match(result, /is not a file/);
    });
  });

  describe('listDirectoryTool', () => {
    it('lists files in a flat directory', async () => {
      await fs.writeFile(path.join(tempDir, 'a.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'b.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'c.txt'), 'content');

      const result = await listDirectoryTool(tempDir, '.');
      const lines = result.split('\n').sort();
      assert.ok(lines.includes('a.txt'));
      assert.ok(lines.includes('b.txt'));
      assert.ok(lines.includes('c.txt'));
    });

    it('lists files recursively in nested subdirectories', async () => {
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'src', 'nested'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), 'code');
      await fs.writeFile(path.join(tempDir, 'src', 'nested', 'util.ts'), 'code');

      const result = await listDirectoryTool(tempDir, '.');
      const lines = result.split('\n');
      assert.ok(lines.some(line => line.includes('index.ts')));
      assert.ok(lines.some(line => line.includes('nested') && line.includes('util.ts')));
    });

    it('excludes node_modules directory', async () => {
      await fs.mkdir(path.join(tempDir, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'node_modules', 'pkg.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'code');

      const result = await listDirectoryTool(tempDir, '.');
      assert.ok(result.includes('app.ts'));
      assert.ok(!result.includes('pkg.txt'));
    });

    it('excludes .git directory', async () => {
      await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(tempDir, '.git', 'config'), 'content');
      await fs.writeFile(path.join(tempDir, 'main.ts'), 'code');

      const result = await listDirectoryTool(tempDir, '.');
      assert.ok(result.includes('main.ts'));
      assert.ok(!result.includes('config'));
    });

    it('excludes dist, build, .next, coverage directories', async () => {
      const skipDirs = ['dist', 'build', '.next', 'coverage'];
      for (const dir of skipDirs) {
        await fs.mkdir(path.join(tempDir, dir), { recursive: true });
        await fs.writeFile(path.join(tempDir, dir, 'file.txt'), 'content');
      }
      await fs.writeFile(path.join(tempDir, 'src.ts'), 'code');

      const result = await listDirectoryTool(tempDir, '.');
      assert.ok(result.includes('src.ts'));
      for (const dir of skipDirs) {
        assert.ok(!result.includes(dir), `should exclude ${dir}`);
      }
    });

    it('returns "(no files)" for an empty directory', async () => {
      const result = await listDirectoryTool(tempDir, '.');
      assert.equal(result, '(no files)');
    });

    it('returns sorted file list', async () => {
      await fs.writeFile(path.join(tempDir, 'z.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'a.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'm.txt'), 'content');

      const result = await listDirectoryTool(tempDir, '.');
      const lines = result.split('\n');
      assert.deepEqual(lines, ['a.txt', 'm.txt', 'z.txt']);
    });
  });

  describe('grepTool', () => {
    it('finds a matching line and reports it in file:line: text format', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'line 1\nmatch here\nline 3');

      const result = await grepTool(tempDir, 'match');
      assert.match(result, /test\.txt:\d+: match here/);
    });

    it('returns "(no matches)" when pattern is not found', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'line 1\nline 2\nline 3');

      const result = await grepTool(tempDir, 'nomatch');
      assert.equal(result, '(no matches)');
    });

    it('searches recursively across nested files', async () => {
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.writeFile(path.join(tempDir, 'src', 'file1.ts'), 'export const x = 1');
      await fs.writeFile(path.join(tempDir, 'file2.ts'), 'export const y = 2');

      const result = await grepTool(tempDir, 'export');
      const lines = result.split('\n');
      assert.equal(lines.length, 2);
      assert.ok(lines.some(l => l.includes('file1.ts')));
      assert.ok(lines.some(l => l.includes('file2.ts')));
    });

    it('returns error message for an invalid regex pattern', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'content');

      const result = await grepTool(tempDir, '(abc');
      assert.match(result, /invalid regular expression/);
      assert.ok(!result.startsWith('error'));
    });

    it('does not report matches from node_modules', async () => {
      await fs.mkdir(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'node_modules', 'pkg', 'index.js'), 'match this');
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'other content');

      const result = await grepTool(tempDir, 'match');
      assert.equal(result, '(no matches)');
    });

    it('does not report matches from .git', async () => {
      await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(tempDir, '.git', 'config'), 'match this');
      await fs.writeFile(path.join(tempDir, 'main.ts'), 'other');

      const result = await grepTool(tempDir, 'match');
      assert.equal(result, '(no matches)');
    });

    it('reports line numbers starting at 1', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'line 0\nline 1\nfound here');

      const result = await grepTool(tempDir, 'found');
      assert.match(result, /:\d+:/);
      const match = result.match(/:(\d+):/);
      assert.ok(match);
      assert.equal(parseInt(match![1]!), 3);
    });
  });

  describe('editFileTool', () => {
    it('successfully replaces a unique occurrence', async () => {
      const testFile = path.join(tempDir, 'edit.txt');
      await fs.writeFile(testFile, 'hello world\nfoo bar');

      const result = await editFileTool(tempDir, 'edit.txt', 'hello world', 'goodbye world');
      assert.match(result, /edited/);

      const content = await fs.readFile(testFile, 'utf8');
      assert.equal(content, 'goodbye world\nfoo bar');
    });

    it('returns "not found" message when oldString is absent', async () => {
      const testFile = path.join(tempDir, 'edit.txt');
      await fs.writeFile(testFile, 'original content');

      const result = await editFileTool(tempDir, 'edit.txt', 'notfound', 'replacement');
      assert.match(result, /old_string not found/);

      const content = await fs.readFile(testFile, 'utf8');
      assert.equal(content, 'original content');
    });

    it('returns "ambiguous" message when oldString appears more than once', async () => {
      const testFile = path.join(tempDir, 'edit.txt');
      const content = 'duplicate\nother\nduplicate';
      await fs.writeFile(testFile, content);

      const result = await editFileTool(tempDir, 'edit.txt', 'duplicate', 'unique');
      assert.match(result, /appears .* times/i);

      const fileContent = await fs.readFile(testFile, 'utf8');
      assert.equal(fileContent, content, 'file should be unchanged');
    });

    it('path-traversal protection: prevents editing outside cwd', async () => {
      const parentDir = path.dirname(tempDir);
      const outsideFile = path.join(parentDir, 'outside.txt');
      await fs.writeFile(outsideFile, 'outside content', 'utf8');

      try {
        await assert.rejects(
          () => editFileTool(tempDir, '../outside.txt', 'outside', 'changed'),
          ToolPathError
        );

        const fileContent = await fs.readFile(outsideFile, 'utf8');
        assert.equal(fileContent, 'outside content', 'outside file should be untouched');
      } finally {
        await fs.rm(outsideFile, { force: true });
      }
    });

    it('throws for a file that does not exist', async () => {
      await assert.rejects(
        () => editFileTool(tempDir, 'nonexistent.txt', 'old', 'new'),
        /ENOENT/
      );
    });
  });

  describe('executeTool', () => {
    it('dispatches read_file with path JSON argument correctly', async () => {
      const testFile = path.join(tempDir, 'read.txt');
      const content = 'test content';
      await fs.writeFile(testFile, content, 'utf8');

      const result = await executeTool(
        {
          id: '1',
          name: 'read_file',
          arguments: JSON.stringify({ path: 'read.txt' }),
        },
        tempDir
      );
      assert.equal(result, content);
    });

    it('dispatches list_directory with optional path argument', async () => {
      await fs.writeFile(path.join(tempDir, 'a.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'b.txt'), 'content');

      const result = await executeTool(
        {
          id: '1',
          name: 'list_directory',
          arguments: JSON.stringify({ path: '.' }),
        },
        tempDir
      );
      assert.ok(result.includes('a.txt'));
      assert.ok(result.includes('b.txt'));
    });

    it('dispatches grep with pattern and optional path', async () => {
      await fs.writeFile(path.join(tempDir, 'test.ts'), 'export const x = 1');

      const result = await executeTool(
        {
          id: '1',
          name: 'grep',
          arguments: JSON.stringify({ pattern: 'export', path: '.' }),
        },
        tempDir
      );
      assert.match(result, /export/);
    });

    it('dispatches edit_file with all three JSON arguments correctly', async () => {
      const testFile = path.join(tempDir, 'edit.txt');
      await fs.writeFile(testFile, 'old text here');

      const result = await executeTool(
        {
          id: '1',
          name: 'edit_file',
          arguments: JSON.stringify({
            path: 'edit.txt',
            old_string: 'old text',
            new_string: 'new text',
          }),
        },
        tempDir
      );
      assert.match(result, /edited/);

      const content = await fs.readFile(testFile, 'utf8');
      assert.equal(content, 'new text here');
    });

    it('returns string result for invalid JSON in arguments', async () => {
      const result = await executeTool(
        {
          id: '1',
          name: 'read_file',
          arguments: 'not json',
        },
        tempDir
      );
      assert.match(result, /invalid JSON arguments/);
      assert.ok(typeof result === 'string');
    });

    it('returns string result for missing required argument (read_file without path)', async () => {
      const result = await executeTool(
        {
          id: '1',
          name: 'read_file',
          arguments: JSON.stringify({}),
        },
        tempDir
      );
      assert.match(result, /missing required argument.*path/);
    });

    it('returns string result for missing required argument (grep without pattern)', async () => {
      const result = await executeTool(
        {
          id: '1',
          name: 'grep',
          arguments: JSON.stringify({ path: '.' }),
        },
        tempDir
      );
      assert.match(result, /missing required argument.*pattern/);
    });

    it('returns string result for missing required arguments (edit_file)', async () => {
      const result = await executeTool(
        {
          id: '1',
          name: 'edit_file',
          arguments: JSON.stringify({ path: 'file.txt' }),
        },
        tempDir
      );
      assert.match(result, /missing required argument/);
    });

    it('returns string result for unknown tool name', async () => {
      const result = await executeTool(
        {
          id: '1',
          name: 'unknown_tool',
          arguments: JSON.stringify({}),
        },
        tempDir
      );
      assert.match(result, /unknown tool/);
    });

    it('never throws or rejects, even for nonexistent file read', async () => {
      const result = await executeTool(
        {
          id: '1',
          name: 'read_file',
          arguments: JSON.stringify({ path: 'nonexistent.txt' }),
        },
        tempDir
      );
      assert.ok(typeof result === 'string');
      assert.match(result, /error/);
    });

    it('catches path-traversal attempts and returns error string', async () => {
      const result = await executeTool(
        {
          id: '1',
          name: 'read_file',
          arguments: JSON.stringify({ path: '../outside.txt' }),
        },
        tempDir
      );
      assert.ok(typeof result === 'string');
      assert.match(result, /error.*escapes/);
    });

    it('has correct TOOL_DEFINITIONS export', () => {
      assert.ok(Array.isArray(TOOL_DEFINITIONS));
      assert.equal(TOOL_DEFINITIONS.length, 4);

      const names = TOOL_DEFINITIONS.map((def: any) => def.function.name);
      assert.deepEqual(names, ['read_file', 'list_directory', 'grep', 'edit_file']);

      // Check that each definition has required structure
      for (const def of TOOL_DEFINITIONS) {
        assert.equal(def.type, 'function');
        assert.ok(def.function.name);
        assert.ok(def.function.description);
        assert.ok(def.function.parameters);
        assert.equal(def.function.parameters.type, 'object');
        assert.ok(def.function.parameters.properties);
      }
    });
  });

  describe('edge cases', () => {
    it('handles files with various encodings as UTF-8', async () => {
      const testFile = path.join(tempDir, 'utf8.txt');
      const content = 'Hello 世界 🌍';
      await fs.writeFile(testFile, content, 'utf8');

      const result = await readFileTool(tempDir, 'utf8.txt');
      assert.equal(result, content);
    });

    it('grep with line containing leading/trailing spaces uses trim', async () => {
      const testFile = path.join(tempDir, 'spaces.txt');
      await fs.writeFile(testFile, '  line with spaces  ');

      const result = await grepTool(tempDir, 'line with spaces');
      assert.ok(result.includes('line with spaces'));
    });

    it('listDirectoryTool without path argument defaults to "."', async () => {
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content');

      const result = await listDirectoryTool(tempDir);
      assert.ok(result.includes('file.txt'));
    });

    it('grepTool without path argument defaults to "."', async () => {
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'search me');

      const result = await grepTool(tempDir, 'search');
      assert.ok(result.includes('search me'));
    });

    it('executeTool with non-object arguments defaults to empty object', async () => {
      const result = await executeTool(
        {
          id: '1',
          name: 'read_file',
          arguments: JSON.stringify(null),
        },
        tempDir
      );
      assert.match(result, /missing required argument/);
    });
  });
});
