# Setup Gemini API Key

## Get Your API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Get API key"  
3. Copy your API key

## Add to Environment

Edit `.env.local`:

```bash
VITE_GEMINI_API_KEY=AIzaSyB4FFB96YQa_DFBEUV1TPny5tQcprlGmEg
```

Then restart the backend:

```bash
pkill -f "python.*atlantean_backend"
python atlantean_backend.py
```

## Verify Backend Has Key

Make sure the backend process has the key loaded:

```bash
# Check if key is set
echo $GEMINI_API_KEY

# Restart backend to pick up new key
pkill -f "python.*atlantean_backend"
python atlantean_backend.py
```

## Verify It's Working

When you chat, you should see:
- ✅ Real Gemini responses (not "This is a demo response")
- ✅ Intelligence state context in responses
- ✅ Learning signals being applied

## Current Status

Without API key: You'll see demo responses with intelligence field stats

With API key: Full Gemini AI responses powered by Atlantean Intelligence Core!
