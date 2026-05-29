# User Manual

This guide explains how to run, test, and use the app.

The app supports a home appliance service workflow and can:

- talk through an appliance problem
- remember what was already said
- suggest technician visit times
- book a visit when a time is accepted
- send a photo upload link
- analyze an uploaded appliance photo

## What You Are Looking At

There are two main user surfaces:

1. The dashboard at `http://localhost:4173`
2. The photo upload page that opens from a unique upload link

The dashboard is the main testing console.
It is where you start or continue a call session and watch the conversation.

The upload page is the customer-facing photo step.
It is what someone would open after receiving an email or upload link.

## Before You Start

Make sure these are ready:

- Docker is running
- Ollama is installed and running on your machine
- the local models are available
- `PHONE_PROVIDER` is left at `local` unless you want to exercise Twilio webhook validation

Check Ollama:

```bash
ollama list
```

You should have these models:

- `llama3.2`
- `llama3.2-vision`

If they are missing:

```bash
ollama pull llama3.2
ollama pull llama3.2-vision
```

## How To Start The App

From the repo root, run:

```bash
docker compose up --build
```

Then open:

```text
http://localhost:4173
```

If the page does not load, wait a little longer for the server and database to finish starting.

## Phone Provider Modes

The app starts in local phone mode by default.
That mode lets you test the voice workflow from the dashboard and the server tests without a Twilio account, public webhook, or phone number.

If you want the Twilio webhook path instead, set these environment variables before starting the app:

- `PHONE_PROVIDER=twilio`
- `PUBLIC_WEBHOOK_BASE_URL=https://your-public-host`
- `TWILIO_AUTH_TOKEN=your-twilio-auth-token`

If any of those Twilio values are missing or not trusted, the webhook route fails closed and returns `503`.

## How To Test The Main Flow

This is the easiest end to end test.

### 1. Start a new call

On the dashboard:

- click `New call`
- enter a caller name
- enter a phone number
- enter an email
- enter a zip code
- describe the appliance problem in the first message

Example first message:

```text
My refrigerator is warm and making a buzzing noise.
```

Then submit the call.

What should happen:

- a new session appears in the left-side call list
- that session becomes selected automatically
- the transcript opens on the right
- the assistant responds in the transcript

### 2. Continue the call

Once a call is selected, keep using the same selected session.

Type follow-up messages such as:

```text
It still is not cooling properly.
```

```text
I hear the buzzing every few minutes.
```

```text
Can you send me a photo link?
```

What should happen:

- the assistant should not ask for the same details again if they are already known
- the transcript should keep growing in the selected session
- the session status and next actions should update as the conversation progresses

### 3. Test scheduling

When the agent decides the issue needs a technician, it should move toward scheduling.

Tell the agent what timing works for you.

Example:

```text
Friday afternoon works for me.
```

Then accept a slot if the agent proposes one.

Example:

```text
Yes, book that time.
```

What should happen:

- the assistant should confirm the appointment in the transcript
- the visit card should show the scheduled technician and appointment window
- a confirmation code should appear

### 4. Test the upload link flow

Ask for a photo link or use the `Send link` action in the selected session.

What should happen:

- the `Photo` section should show a new upload session
- the `Recent emails` section should show the email that would have been sent
- the upload entry should include an `Open` link

Click `Open`.

That takes you to the upload page for that specific photo request.

### 5. Upload a photo

On the upload page:

- choose an appliance image
- click the upload button

What should happen:

- the upload should complete
- the page should show an analyzed result
- the analysis should include a short summary and any visible issues it found

Then go back to the dashboard.

In the selected call session:

- the photo card should show the uploaded result
- the analysis summary should be visible

## Recommended Full Demo Script

If you want one clean demo from start to finish, use this:

1. Start a new call
2. Say:

```text
My refrigerator is warm and making a buzzing noise.
```

3. Reply to the assistant with one or two more details
4. Ask for a photo link:

```text
Can you send me a photo link?
```

5. Open the upload page and upload a refrigerator photo
6. Return to the same call session
7. Tell the agent you want a visit:

```text
I would like to schedule a technician.
```

8. Tell it what timing works:

```text
Friday afternoon works for me.
```

9. Accept the proposed slot:

```text
Yes, book that appointment.
```

10. Confirm the transcript shows the booked appointment details

## What Each Area Means

### Left side call list

This shows recent call sessions.

Use it to:

- switch between calls
- reopen an existing conversation
- review what happened in older sessions

### Transcript

This is the back and forth conversation.

It should show:

- caller messages
- assistant messages
- tool-related progress when relevant

This is the best place to confirm whether the conversation feels natural.

### Next actions

This shows the current troubleshooting steps.

Use it to see what the assistant thinks the customer should try next.

### Visit

This area shows:

- recommended technician slots
- the booked appointment if one exists
- the confirmation code after booking

### Photo

This area shows:

- upload requests
- upload status
- analysis summary after the image is processed

### Recent emails

This is a local outbox preview.
It lets you inspect what the email would have said without needing a real email provider.

## Phone Testing

The repo also includes a Twilio-compatible inbound voice webhook:

```text
/api/phone/twilio/voice
```

At the moment, the browser dashboard is the easiest way to test the app locally.

The phone path needs:

- a real Twilio or similar account
- a public webhook URL
- a real phone number provisioned outside the repo

If you do not have that, use the dashboard flow instead.

## Common Problems

### The page says it cannot connect

Check that `docker compose up --build` is still running and the server did not crash.

### The assistant does not answer well

Check that Ollama is running and the local models exist:

```bash
ollama list
```

### Upload analysis does not complete

Usually this means the vision model is missing.
Make sure `llama3.2-vision` is installed.

### The browser voice mode fails

Use typed input instead.
The typed path is the most reliable local testing mode.

### Scheduling does not progress

Stay in the same selected call session.
Tell the assistant when you are available and then explicitly accept a proposed time.

## Best Way To Review The App

If someone is reviewing the project for the first time, this is the shortest useful path:

1. Start the stack
2. Open the dashboard
3. Create one call
4. Continue the call for multiple turns
5. Request a photo link
6. Upload a real image
7. Return to the same session
8. Ask to schedule a visit
9. Accept a proposed time
10. Confirm the final transcript, visit card, and photo analysis all reflect the same session

## Related Docs

- [README.md](/Users/lucas/src/lucas-barake/household-ops-platform/README.md)
- [docs/technical-design.md](/Users/lucas/src/lucas-barake/household-ops-platform/docs/technical-design.md)
