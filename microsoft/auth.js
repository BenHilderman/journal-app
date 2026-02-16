import { ConfidentialClientApplication } from '@azure/msal-node';
import jwksRsa from 'jwks-rsa';
import jwt from 'jsonwebtoken';

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const AZURE_AUDIENCE = process.env.AZURE_AUDIENCE || `api://${AZURE_CLIENT_ID}`;

// JWKS client — fetches Microsoft's signing keys for token validation
const jwksClient = jwksRsa({
  jwksUri: `https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
  rateLimit: true,
});

function getSigningKey(header, callback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

/**
 * Validates an Azure AD JWT Bearer token.
 * Returns the decoded token payload or throws on invalid/expired tokens.
 */
export function validateAzureToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        audience: AZURE_AUDIENCE,
        issuer: [
          `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`,
          `https://sts.windows.net/${AZURE_TENANT_ID}/`,
        ],
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

// MSAL ConfidentialClientApplication for server-to-server token acquisition
let msalClient = null;

export function getMsalClient() {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: AZURE_CLIENT_ID,
        clientSecret: AZURE_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
      },
    });
  }
  return msalClient;
}

/**
 * Acquires an app-level token for calling Microsoft Graph or Dataverse.
 * Uses client_credentials flow (no user interaction).
 */
export async function acquireAppToken(scope = 'https://graph.microsoft.com/.default') {
  const client = getMsalClient();
  const result = await client.acquireTokenByClientCredential({ scopes: [scope] });
  return result.accessToken;
}

/**
 * Express middleware that validates Azure AD Bearer tokens.
 * Sets req.azureUser with { oid, email, name } from the token claims.
 * Passes through if no Authorization header (allows session auth to handle it).
 */
export function azureAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(); // No Bearer token — fall through to session auth
  }

  const token = authHeader.slice(7);
  validateAzureToken(token)
    .then((decoded) => {
      req.azureUser = {
        oid: decoded.oid,
        email: decoded.preferred_username || decoded.upn || decoded.email,
        name: decoded.name || decoded.given_name || 'Azure User',
      };
      next();
    })
    .catch((err) => {
      console.error('Azure token validation failed:', err.message);
      res.status(401).json({ error: 'Invalid or expired Azure AD token' });
    });
}
