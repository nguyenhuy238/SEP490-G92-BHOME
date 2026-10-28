FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /source
COPY global.json Directory.Build.targets ./
COPY src/backend/ src/backend/
COPY tools/BHome.OcrSmoke/ tools/BHome.OcrSmoke/
RUN dotnet publish tools/BHome.OcrSmoke/BHome.OcrSmoke.csproj -c Release -r linux-x64 --self-contained false -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app ./
COPY tests/fixtures/ocr/ /fixtures/
USER $APP_UID
ENTRYPOINT ["dotnet", "BHome.OcrSmoke.dll", "/models", "/fixtures"]
