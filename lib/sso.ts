import { randomUUID } from "crypto";
import type { IdentityProviderConfig } from "@prisma/client";
import { env } from "./env";

export function buildOidcAuthorizationUrl(params: {
  provider: Pick<
    IdentityProviderConfig,
    "issuerUrl" | "authorizationEndpoint" | "clientId"
  >;
  state: string;
  nonce: string;
  codeChallenge: string;
}) {
  const endpoint = params.provider.authorizationEndpoint ?? `${params.provider.issuerUrl ?? ""}/authorize`;
  const url = new URL(endpoint);
  url.searchParams.set("client_id", params.provider.clientId ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("redirect_uri", `${env.NEXT_PUBLIC_APP_URL}/api/auth/sso/oidc/callback`);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "plain");
  return url.toString();
}

export function buildSamlMetadataXml(params: {
  entityId: string;
  acsUrl: string;
  ssoUrl: string;
  certificatePem?: string | null;
}) {
  const certXml = params.certificatePem ? `<ds:X509Certificate>${params.certificatePem}</ds:X509Certificate>` : "";
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<EntityDescriptor entityID="${params.entityId}" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">`,
    `  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
    certXml ? `    <KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certXml}</ds:KeyInfo></KeyDescriptor>` : "",
    `    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${params.acsUrl}" index="1"/>`,
    `  </SPSSODescriptor>`,
    `  <Extensions><HookForgeSSO>${params.ssoUrl}</HookForgeSSO></Extensions>`,
    `</EntityDescriptor>`
  ]
    .filter(Boolean)
    .join("");
}

export function parseSamlAcsPayload(body: { nameId?: string; email?: string; samlResponse?: string }) {
  const identity = body.nameId?.trim() || body.email?.trim() || `saml-${randomUUID()}`;
  const email = body.email?.trim().toLowerCase() || `${identity.replace(/[^a-zA-Z0-9._-]/g, "")}@sso.local`;
  return {
    providerSubject: identity,
    email
  };
}
