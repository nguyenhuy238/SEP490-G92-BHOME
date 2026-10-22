FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /source
COPY global.json ./
COPY src/backend/ src/backend/
RUN dotnet restore src/backend/BHome.Api/BHome.Api.csproj
RUN dotnet publish src/backend/BHome.Api/BHome.Api.csproj -c Release --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_HTTP_PORTS=8080
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "BHome.Api.dll"]
