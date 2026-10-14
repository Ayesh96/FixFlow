# Running Code Akos in Docker

If your apps already run in Docker, you can run Code Akos beside them. Your apps report errors to it by service name, for example `http://key@code-akos:3000/1`.

## Run it

Copy [docker-compose.yml](docker-compose.yml) next to your own `docker-compose.yml`, or merge the `code-akos` service into it. Change `ORCH_ERRORS_DSN_PUBLIC_KEY` to a long random value, then start it:

```bash
docker compose up -d code-akos
docker compose logs code-akos
```

`latest` is the newest release. To upgrade only when you choose, use a version tag instead, such as `1.4.0` (the [releases](https://github.com/Ayesh96/code-akos/releases) list them).

The log shows a line like `Dashboard  →  http://localhost:7420/?token=…`. Open that link once in your browser. The browser remembers the token after that. The token is also saved in `/data/token` inside the volume.

To try it without Compose:

```bash
docker run -d --name code-akos \
  -p 127.0.0.1:7420:7420 \
  -v code-akos-data:/data \
  ghcr.io/ayesh96/code-akos:latest
```

## Connect your apps

Apps in the same Compose file reach Code Akos by its service name. The ingest port (3000) is **not** published to your host, so nothing outside the Compose network can send errors to it.

1. In the dashboard, add a project. Its ID is the number at the end of the DSN.
2. Set your app's DSN to `http://<key>@code-akos:3000/<id>`, where `<key>` is your `ORCH_ERRORS_DSN_PUBLIC_KEY`. In the example file this is the `SENTRY_DSN` variable of the `app` service.

`ORCH_ERRORS_PUBLIC_URL=http://code-akos:3000` makes the dashboard show this address in its connect guide, instead of `localhost`.

An app that runs on the host, outside Docker, cannot use the service name. Publish the ingest port for it with `"127.0.0.1:3000:3000"` and use `http://<key>@localhost:3000/<id>`.

## Use Ollama on the host

Set `ORCH_OLLAMA_URL=http://host.docker.internal:11434`. On Linux, also add `extra_hosts: ["host.docker.internal:host-gateway"]` to the service. Docker Desktop on macOS and Windows does not need that line. Ollama must listen on an address the container can reach: on Linux, start it with `OLLAMA_HOST=0.0.0.0`.

You can also use DeepSeek or Anthropic: set the same variables as in [`.env.example`](https://github.com/Ayesh96/code-akos/blob/main/.env.example).

## The check command and the image

The resolver runs each project's check command (for example `npm test` or `pytest`) **inside the Code Akos container**. The image has only Node and git. If your project needs other tools, the check fails, and the pull request is marked **unverified**. Code Akos does not mount the Docker socket, so it cannot start other containers.

To fix this, build your own image on top of Code Akos and install your tools:

```dockerfile
FROM ghcr.io/ayesh96/code-akos:latest
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
USER node
```

Then build it and use it as the `image` in your Compose file (or use `build:` there).

## Upgrade

Pull a new tag and recreate the container. Your data stays in the `code-akos-data` volume.

```bash
# set the new version in the image line first
docker compose pull code-akos
docker compose up -d code-akos
```

If you built your own image, change its `FROM` line to the new tag and build again. To back up, copy the volume: it holds the token, the databases, the encryption key, the clones and the logs.

## Security

- Publish the dashboard on `127.0.0.1` only: `"127.0.0.1:7420:7420"`. It holds your GitHub tokens and can push code. Inside the container it listens on all interfaces, so the published address is what keeps it private. The container prints a warning about this at startup.
- If you publish it on another port, such as `127.0.0.1:8080:7420`, set `ORCH_DASHBOARD_PUBLIC_PORT=8080` so the Host check accepts it. Only `localhost`, `127.0.0.1` and `[::1]` are accepted as names.
- Set `ORCH_ERRORS_DSN_PUBLIC_KEY`. Ingest has no other protection, and anyone on the Compose network can reach it.
- Keep the token private. Anyone with the volume's `token` file can use the dashboard.
- Do not mount the Docker socket into the container.
