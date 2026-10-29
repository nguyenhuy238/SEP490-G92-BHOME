CREATE TABLE "SigningCertificates" (
    "Id" uuid NOT NULL,
    "OwnerUserId" uuid NOT NULL,
    "Provider" character varying(32) NOT NULL,
    "ProviderUserId" character varying(100) NOT NULL,
    "CredentialId" character varying(200) NOT NULL,
    "SerialNumber" character varying(100) NOT NULL,
    "Subject" character varying(1000) NOT NULL,
    "Issuer" character varying(1000) NOT NULL,
    "ValidFrom" timestamp with time zone NOT NULL,
    "ValidTo" timestamp with time zone NOT NULL,
    "Locked" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_SigningCertificates" PRIMARY KEY ("Id")
);


CREATE TABLE "SigningSettings" (
    "Id" smallint NOT NULL,
    "ViettelBaseUrl" character varying(300),
    "ViettelClientId" character varying(200),
    "ViettelProfileId" character varying(200),
    "ViettelSecretEncrypted" text,
    "UpdatedByUserId" uuid,
    "UpdatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_SigningSettings" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_SigningSettings_SingleRow" CHECK ("Id" = 1)
);


CREATE TABLE "SigningTransactions" (
    "Id" uuid NOT NULL,
    "CertificateId" uuid,
    "RequestedByUserId" uuid NOT NULL,
    "Provider" character varying(32) NOT NULL,
    "ProviderUserId" character varying(100) NOT NULL,
    "CredentialId" character varying(200) NOT NULL,
    "SerialNumber" character varying(100) NOT NULL,
    "ProviderTransactionId" character varying(200),
    "Status" character varying(20) NOT NULL,
    "DocumentName" character varying(200) NOT NULL,
    "SourcePdfSha256" character(64) NOT NULL,
    "FieldName" character varying(64) NOT NULL,
    "PreparedPdf" bytea NOT NULL,
    "DocumentDigest" bytea NOT NULL,
    "DataToSignSha256" character(64) NOT NULL,
    "CertificateChain" text NOT NULL,
    "SigningDate" timestamp with time zone NOT NULL,
    "Description" character varying(200),
    "SignedPdf" bytea,
    "ErrorCode" character varying(64),
    "ErrorMessage" character varying(1000),
    "ExpiresAt" timestamp with time zone NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_SigningTransactions" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_SigningTransactions_SigningCertificates_CertificateId" FOREIGN KEY ("CertificateId") REFERENCES "SigningCertificates" ("Id") ON DELETE SET NULL
);


CREATE INDEX "IX_SigningCertificates_OwnerUserId" ON "SigningCertificates" ("OwnerUserId");


CREATE UNIQUE INDEX "IX_SigningCertificates_Provider_SerialNumber" ON "SigningCertificates" ("Provider", "SerialNumber");


CREATE INDEX "IX_SigningTransactions_CertificateId" ON "SigningTransactions" ("CertificateId");


CREATE INDEX "IX_SigningTransactions_RequestedByUserId_CreatedAt" ON "SigningTransactions" ("RequestedByUserId", "CreatedAt");




CREATE TABLE "SignatureImages" (
    "OwnerUserId" uuid NOT NULL,
    "Content" bytea NOT NULL,
    "Width" integer NOT NULL,
    "Height" integer NOT NULL,
    "Sha256" character(64) NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_SignatureImages" PRIMARY KEY ("OwnerUserId")
);
