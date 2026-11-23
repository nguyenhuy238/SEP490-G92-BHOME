# Release image shared by Staging and Production.
# Keep this in source control so the deployed runtime stays reproducible.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS source

WORKDIR /source

COPY global.json Directory.Build.targets ./
COPY .config/ .config/
COPY src/backend/ src/backend/
COPY src/digital-signing/ src/digital-signing/
COPY packages/client-core/src/errorMessages.json packages/client-core/src/errorMessages.json
COPY docs/database/ docs/database/
COPY docs/mau-hop-dong-thue-nha-tro-ngan-gon.docx docs/
COPY tools/BHome.LocalDevelopment/ tools/BHome.LocalDevelopment/

FROM source AS build

RUN dotnet publish src/backend/BHome.Api/BHome.Api.csproj -c Release -o /app

# Optional offline schema artifact for an explicitly reviewed database bootstrap.
# This target is never used by the application image build or deployment workflow.
FROM source AS schema

RUN dotnet tool restore

ENV BHOME_COMPACT24_DIRECT="Host=127.0.0.1;Database=bhome_compact24_00000000000000000000000000000000;Username=offline;Password=offline"

RUN mkdir /out && dotnet ef migrations script 0 --no-transactions \
    --context Compact24DbContext \
    --project src/backend/BHome.Infrastructure \
    --startup-project src/backend/BHome.Api \
    --configuration Release --output /out/compact24.sql

FROM scratch AS schema-output

COPY --from=schema /out/ /

FROM source AS seed-build

RUN dotnet publish tools/BHome.LocalDevelopment/BHome.LocalDevelopment.csproj -c Release -o /seed

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS runtime-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libreoffice-writer poppler-utils fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=8080
ENV MainDraft__LibreOfficePath=/usr/bin/libreoffice
ENV MainDraft__PdfToPpmPath=/usr/bin/pdftoppm
ENV HOME=/home/app

USER $APP_UID

FROM runtime-base AS seed

COPY --from=seed-build /seed/ ./

ENTRYPOINT ["dotnet", "BHome.LocalDevelopment.dll"]

FROM runtime-base AS api

COPY --from=build /app/ ./

EXPOSE 8080

ENTRYPOINT ["dotnet", "BHome.Api.dll"]
