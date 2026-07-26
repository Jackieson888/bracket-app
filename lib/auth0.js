import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { secret } from "@aws-amplify/backend";
export const auth0 = new Auth0Client({
  domain: secret("AUTH0_DOMAIN"),
  clientId: secret("AUTH0_CLIENT_ID"),
  clientSecret: secret("AUTH0_CLIENT_SECRET"),
  secret: secret("AUTH0_SECRET"),
  baseURL: secret("APP_BASE_URL"),
});
