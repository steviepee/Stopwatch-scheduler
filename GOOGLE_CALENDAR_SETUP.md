# Google Calendar API Setup Guide

Follow these steps to enable Google Calendar integration for the Stopwatch Scheduler app.

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" at the top
3. Click "New Project"
4. Enter a project name (e.g., "Stopwatch Scheduler")
5. Click "Create"

## Step 2: Enable Google Calendar API

1. In your project, go to "APIs & Services" > "Library"
2. Search for "Google Calendar API"
3. Click on it and click "Enable"

## Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. If prompted, configure the OAuth consent screen:
   - User Type: External
   - App name: Stopwatch Scheduler
   - User support email: Your email
   - Developer contact: Your email
   - Click "Save and Continue"
   - Scopes: Click "Save and Continue" (we'll add scopes in code)
   - Test users: Add your email if in testing mode
   - Click "Save and Continue"

4. Create OAuth client ID:
   - Application type: Web application
   - Name: Stopwatch Scheduler Web Client
   - Authorized redirect URIs: Add `http://localhost:8000/api/auth/callback`
   - Click "Create"

5. Download the credentials:
   - You'll see your Client ID and Client Secret
   - Copy these for the next step

## Step 4: Configure Your Application

1. Copy `backend/.env.example` to `backend/.env`
2. Fill in your Google Calendar credentials:

```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/callback
```

## Step 5: Test the Integration

1. Start your backend server
2. Start your frontend app
3. Click "Connect Google Calendar" in the app
4. You'll be redirected to Google's OAuth consent screen
5. Grant the necessary permissions
6. You'll be redirected back to the app

## Troubleshooting

### "Redirect URI mismatch" error
- Make sure the redirect URI in Google Cloud Console exactly matches `http://localhost:8000/api/auth/callback`
- No trailing slashes
- Use http (not https) for local development

### "Access blocked: This app's request is invalid"
- Complete the OAuth consent screen configuration
- Add your email as a test user if in testing mode

### Credentials not working
- Make sure you copied the entire Client ID and Secret
- Check that there are no extra spaces in your .env file
- Restart your backend server after updating .env

## Production Deployment

When deploying to production:

1. Update the redirect URI to your production domain
2. Add the production redirect URI to Google Cloud Console
3. Submit your app for verification if you want to remove the "unverified app" warning
4. Use environment variables for credentials (never commit .env to git)
