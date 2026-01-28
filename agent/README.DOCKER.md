Quick Docker run for the Fairway Sniper agent

This folder contains a Dockerfile and docker-compose config to run the agent in a container
which bundles Playwright's browsers and isolates the agent from host conflicts.

Prerequisites

- Docker Desktop installed and running (Windows)

Build and run (one-liner):

```
cd agent
docker-compose up --build
```

This will:

- build an image with Playwright browsers
- start the agent HTTP server on port 3000
- map `./output` and `./logs` to the container for traces and logs

Debugging and headed runs

- By default `AGENT_HEADLESS=false` is set in docker-compose to allow headed runs, but
  to see the browser UI you need to run Docker with an X server or use VNC; alternatively
  set `AGENT_HEADLESS=true` to run headless.

Trace output

- When you POST to `/api/fetch-tee-times` with `debug=true` the agent will save a Playwright
  trace into `./output` (exposed from the container).

If you want me to generate a minimal docker-compose variant that runs a single fetch and then
exits (for CI), I can add that as well.
