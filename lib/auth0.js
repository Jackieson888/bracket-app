import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { secret } from "@aws-amplify/backend";

let auth0Instance;

export function getAuth0() {
  if (!auth0Instance) {
    let cfg = {};
    try {
      cfg.domain = secret("AUTH0_DOMAIN");
      cfg.clientId = secret("AUTH0_CLIENT_ID");
      cfg.clientSecret = secret("AUTH0_CLIENT_SECRET");
      cfg.secret = secret("AUTH0_SECRET");
      cfg.baseURL = secret("APP_BASE_URL");
    } catch (e) {
      // secret() may throw or be unavailable during build/prerender — fall back below
    }

    const hasRequired = cfg.domain && cfg.clientId;

    if (hasRequired) {
      auth0Instance = new Auth0Client({
        domain: cfg.domain,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        secret: cfg.secret,
        baseURL: cfg.baseURL,
      });
    } else {
      // Return a lightweight stub to avoid throwing during prerender/build time.
      auth0Instance = {
        getSession: async () => null,
        middleware: async () => ({ status: 404 }),
        handle: async () => ({}),
      };
    }
  }
  return auth0Instance;
}
