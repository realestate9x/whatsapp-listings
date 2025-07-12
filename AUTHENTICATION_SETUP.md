# Authentication Setup Guide

## Problem
The frontend uses Supabase JWT tokens, but the backend expects custom JWT tokens. This causes authentication failures.

## Solution
Configure the backend to accept both Supabase and custom JWT tokens.

## Step 1: Get Supabase JWT Secret

1. Go to your Supabase project dashboard: https://supabase.com/dashboard
2. Navigate to **Settings** → **API**
3. Find the **JWT Secret** (NOT the anon key)
4. Copy the JWT Secret value

## Step 2: Configure Backend Environment

### For Local Development:
Create/update `.env` file in `realestate_listing/whatsapp-listings/`:

```env
# Supabase Configuration
SUPABASE_URL=https://rjwdrbwgjkomwfciimue.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqd2RyYndnamtvbXdmY2lpbXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDYxNzMsImV4cCI6MjA2NzYyMjE3M30.zFVG9lG9DUct9Fu0Vuu1KgOWEkvbXxk9rSy0VeFyPcE
SUPABASE_JWT_SECRET=YOUR_SUPABASE_JWT_SECRET_HERE

# Custom JWT Configuration
JWT_SECRET=your-custom-jwt-secret-here

# Node Environment
NODE_ENV=development
```

### For Production (Render):
1. Go to your Render dashboard
2. Select your backend service
3. Go to **Environment**
4. Add these environment variables:
   - `SUPABASE_URL`: `https://rjwdrbwgjkomwfciimue.supabase.co`
   - `SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqd2RyYndnamtvbXdmY2lpbXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDYxNzMsImV4cCI6MjA2NzYyMjE3M30.zFVG9lG9DUct9Fu0Vuu1KgOWEkvbXxk9rSy0VeFyPcE`
   - `SUPABASE_JWT_SECRET`: `YOUR_SUPABASE_JWT_SECRET_HERE`

## Step 3: Deploy Changes

```bash
# Commit and push changes
git add .
git commit -m "Fix authentication: Support both Supabase and custom JWT tokens"
git push origin main
```

## Step 4: Test Authentication

### Test with curl:
```bash
# Get a test token from your frontend (check browser dev tools)
curl -H "Authorization: Bearer YOUR_SUPABASE_TOKEN" https://whatsapp-listings.onrender.com/my-whatsapp-status
```

## How It Works

The backend now:
1. **First** tries to verify tokens with Supabase JWT secret
2. **Falls back** to custom JWT secret if Supabase verification fails
3. **Supports both** authentication methods

This allows:
- ✅ Frontend to use Supabase authentication
- ✅ Backend to accept Supabase tokens
- ✅ Backward compatibility with custom tokens
- ✅ Proper CORS configuration

## Troubleshooting

If you still get authentication errors:
1. Check browser console for actual error messages
2. Verify the Supabase JWT secret is correct
3. Ensure the token is being sent in the Authorization header
4. Check that CORS is working properly

## Quick Fix for Testing

If you need to test immediately, you can use the custom login endpoint:

```bash
# Get a custom token
curl -X POST https://whatsapp-listings.onrender.com/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Use the returned token
curl -H "Authorization: Bearer YOUR_CUSTOM_TOKEN" https://whatsapp-listings.onrender.com/my-whatsapp-status
``` 