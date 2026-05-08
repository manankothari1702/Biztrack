import { Amplify } from 'aws-amplify';

// Both URLs must be listed so Amplify can pick the one matching window.location.origin.
// Cognito Hosted UI must have both registered as allowed callback/logout URLs.
const appUrl       = import.meta.env.VITE_APP_URL as string | undefined;
const localhostUrl = 'http://localhost:5173';
const redirectUrls = appUrl && appUrl !== localhostUrl
    ? [appUrl, localhostUrl]
    : [localhostUrl];

Amplify.configure({
    Auth: {
        Cognito: {
            userPoolId:       import.meta.env.VITE_COGNITO_USER_POOL_ID,
            userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
            loginWith: {
                oauth: {
                    domain:          import.meta.env.VITE_COGNITO_DOMAIN,
                    scopes:          ['email', 'openid', 'profile'],
                    redirectSignIn:  redirectUrls,
                    redirectSignOut: redirectUrls,
                    responseType:    'code',
                },
            },
        },
    },
});

export const API_URL = import.meta.env.VITE_API_URL as string;