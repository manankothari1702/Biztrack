import { Amplify } from 'aws-amplify';

Amplify.configure({
    Auth: {
        Cognito: {
            userPoolId:       import.meta.env.VITE_COGNITO_USER_POOL_ID,
            userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
            loginWith: {
                oauth: {
                    domain:            import.meta.env.VITE_COGNITO_DOMAIN,
                    scopes:            ['email', 'openid', 'profile'],
                    redirectSignIn:    [import.meta.env.VITE_APP_URL ?? 'http://localhost:5173'],
                    redirectSignOut:   [import.meta.env.VITE_APP_URL ?? 'http://localhost:5173'],
                    responseType:      'code',
                },
            },
        },
    },
});

export const API_URL = import.meta.env.VITE_API_URL as string;
