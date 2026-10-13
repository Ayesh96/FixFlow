---
title: "FixFlow FAQ: licensing, privacy, SDKs and AI fixes"
description: "Is FixFlow free and open source? Does it replace Sentry? Which SDKs work, what leaves your machine and what do AI fixes cost? Answers to common questions."
faq: true
---

# Frequently asked questions

## The basics

### What is FixFlow?

FixFlow is a self-hosted error tracker that works with Sentry SDKs. It receives the errors your app reports, groups repeats, opens a GitHub issue for each new one and has an AI model attempt a fix, which it opens as a pull request for you to review. It runs as a desktop app on macOS, Windows and Linux, or as a single Node.js process on a server.

### Is FixFlow a replacement for Sentry?

For error tracking, yes. FixFlow accepts events from Sentry SDKs, so switching only means changing the DSN in your app. It does not replace the rest of Sentry: there is no performance tracing, session replay, alerting or team accounts. See the [comparison of Sentry alternatives](sentry-alternative.md).

### Do I need to change my code?

Only the `dsn` setting in your Sentry SDK setup. If your app does not use Sentry yet, you install the official Sentry SDK and add a few lines; the [getting started guide](getting-started.md) has the code for Python, Node.js and the browser.

### Which languages and SDKs are supported?

FixFlow implements Sentry's standard `store` and `envelope` endpoints, which all official Sentry SDKs use. The Python SDK has been tested end to end. The dashboard's setup guide includes ready-made code for Python, Node.js and the browser. Other SDKs, such as those for Go, Ruby or PHP, use the same endpoints and are expected to work but have not been tested yet.

### Does FixFlow work with GitLab or Bitbucket?

No. FixFlow files issues and opens pull requests on GitHub only. GitHub Enterprise Server works by pointing FixFlow at your server's API address (`ORCH_GITHUB_API_URL` in the [configuration reference](reference.md#configuration)).

## Cost and licensing

### Is FixFlow free?

Yes. FixFlow is free to download, use and self-host, including at work. If you choose DeepSeek or Anthropic as the model, you pay those providers for what you use. With Ollama, the model runs on your computer at no cost.

### Is FixFlow open source?

FixFlow is source-available under the Functional Source License (FSL-1.1-ALv2). You can read, change and self-host the code freely; the one restriction is that you cannot use it to offer a competing commercial product. Each release automatically becomes Apache 2.0 licensed, a standard open source license, two years after it is published.

### How much do AI fixes cost with a paid API?

Each fix attempt uses at most 20 model calls, and an issue that keeps failing is tried at most 3 times before FixFlow stops on its own. Skipped attempts and successful fixes also use calls. The default hosted models, `deepseek-flash` and `claude-haiku-4-5`, are low-cost models chosen for this kind of short task. To pay nothing, use Ollama.

## Privacy and security

### Does my code leave my computer?

Not if you use Ollama on the same computer. With DeepSeek or Anthropic, the error details and the source files the model reads are sent to that provider. In every case, FixFlow talks to GitHub to file issues and open pull requests. [What leaves your machine](self-hosted-error-tracking.md#what-leaves-your-machine) lists exactly what is sent.

### Where are my GitHub tokens stored?

On your computer, in FixFlow's data folder, encrypted with AES-256-GCM. The key is stored next to them with permissions only you can read, so protect the folder as you would your SSH keys. Tokens are never sent to the browser.

### Can FixFlow merge code or push to my main branch?

No. FixFlow pushes each fix to its own branch, `fixflow/issue-<number>`, and opens a pull request. Merging is always up to you.

### Can the model run commands on my computer?

No. The model can only read files, list folders, search the code and edit files in a temporary copy of your repository. The only command FixFlow runs is the check command you set for the project, such as `npm test`.

## AI fixes

### How is FixFlow different from Sentry Seer?

Both find the cause of an error and can open a fix as a pull request. Seer runs in Sentry's cloud and is a paid add-on. FixFlow runs on your own computer, works with a model you choose, including a free local one, and also runs your tests before and after each change. See [FixFlow resolver vs Sentry Seer](ai-bug-fix-pull-requests.md#fixflow-resolver-vs-sentry-seer).

### How good are the fixes?

The success rate has not been measured yet, and it depends heavily on the model. The resolver is told to make small, focused changes and to skip when it is not sure, and your check command shows whether the tests still pass. Review every pull request as you would one from a new contributor.

### Which model should I use?

Start with `qwen2.5-coder:7b` through Ollama: it is free, private and good enough to see how FixFlow works. For better fixes, add DeepSeek or Anthropic as a second provider. FixFlow uses providers in the order you set and falls back when one fails.

## Running FixFlow

### Can I run FixFlow on a server?

Yes. Run it from source with Node.js 24 or newer and git; see [installation](installation.md#run-fixflow-on-a-server). To receive errors from other machines, open the ingest port to the network, set an access key, and put a reverse proxy with HTTPS in front of it.

### Can several people use one FixFlow?

Not yet. FixFlow has a single login and is designed for one person. The GitHub issues and pull requests it creates are visible to your whole team as usual.

### Why does my Mac or Windows warn me when I open FixFlow?

The builds are not signed with a paid developer certificate yet. macOS asks you to allow the app once in System Settings › Privacy & Security, and Windows SmartScreen asks you to click **More info › Run anyway**. The [installation guide](installation.md#open-fixflow-for-the-first-time) shows both.
