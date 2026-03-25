import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito User Pool auth.
 * Currently configured for email/password sign-in.
 * Extend here to add social providers, MFA, or custom attributes.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
