# Container foundation

Root Compose starts only local PostgreSQL and MinIO. It reads ignored `.env`, binds host ports to
loopback, has named volumes and health checks, and does not deploy clients/API. PostgreSQL is pinned
to major 16. MinIO is built from the official `RELEASE.2025-10-15T17-29-55Z` source tag because community
distribution is source-only. This preserves the required MinIO/S3 architecture without using an
unverified third-party image. Its first build is slower and requires network access to GitHub/Go
modules. Upstream now describes the community repository as unmaintained; assess a supported S3
deployment separately before production. See [upstream guidance](https://github.com/minio/minio).

Build API artifacts from the repository root:

```sh
docker build -f deploy/docker/Api.Dockerfile -t bhome-api .
docker build -f deploy/docker/Web.Dockerfile --build-arg APP=owner-web --build-arg VITE_API_BASE_URL=https://api.example.com -t bhome-owner-web .
docker build -f deploy/docker/Web.Dockerfile --build-arg APP=public-web --build-arg VITE_API_BASE_URL=https://api.example.com -t bhome-public-web .
```

The two web clients share a parameterized Dockerfile and serve SPA fallback with unprivileged Nginx
on port 8080. Vite's API URL is embedded at build time and must never be a secret. Native mobile is
built with Capacitor tooling, not a server container. Docker build contexts exclude private env files,
generated output and local tool downloads.

The API runs as the .NET image's unprivileged app user on port 8080 and requires runtime connection,
JWT and storage configuration. No credentials are baked in, and no migration is applied automatically.

These are deployment building blocks, not a complete production deployment. Before release, provide
TLS termination/trusted proxy forwarding, configured public hosts and exact CORS origins, production
secret management/key rotation, scoped database/storage accounts, private bucket policies, audited
migrations, backup/restore procedures, log retention, durable job monitoring and a supported S3
deployment. If TLS terminates at a proxy, configure trusted forwarded headers before redirection;
disable app redirection only with verified edge enforcement. Health endpoints should be routed through
an appropriate operations boundary. Review/pin image digests in the release process.

No infrastructure container was started during initialization because the local Docker daemon was
stopped. Compose syntax validation does not prove image build/runtime behavior.
