# Assistant

The **Assistant** tab at the top of the sidebar opens a chat with a long-running assistant. A bar
above the chat clocks you in and out of your ERP, shows today's segments, the hours you have
worked against the hours required, and when you can expect to finish. When the required hours are
done, T3 Code reminds you to clock out. After your first clock-in of the day, the assistant drafts
your daily report in the chat for you to review and submit.

## Set up

1. In your ERP, open **My account → API Tokens** and create a token with these four scopes: your
   own clockings and clocking in and out; daily reports and the team dashboard; submitting or
   updating daily reports and syncing activities; the directory, coworker profiles, dropdown data,
   and pending review counts.
2. In T3 Code, open **Settings → Assistant**. Enter your ERP URL, such as
   `https://erp.example.com`, paste the token, and choose **Save**.

Changing the ERP URL removes the saved token, so paste a token for the new address in the same
save. The same page sets the assistant's model and permission mode. The assistant starts in
**Supervised** mode; a change applies to the chat right away.

To draft a report, the assistant reads your calendar. Allow the calendar's read tool, such as the
one that lists events, in Claude's user settings. Otherwise each daily draft stops and waits for
your approval.

## Daily report drafts

Your first clock-in of the day starts a draft, whether you clock in from T3 Code, the ERP website,
or your phone. The draft appears as a card in the chat, listing which sources it could read. Edit
any item on the card, or ask the assistant for changes; a new card keeps your edits and the old one
is marked as replaced. Choose **Submit to ERP** to send the latest card. ERP forwards the report to
Slack as usual.

**Regenerate** starts the draft over and asks first if you have edited it. If drafting fails,
retry it or choose **Fill it in on ERP**. After you submit, the card is read-only; use **Edit it on
ERP** for later changes.

## Assistant memory

The assistant keeps notes on how you like your reports written. Choose **Edit assistant memory**
in **Settings → Assistant** to change them; the next reply follows the new notes.

## Limits

- The assistant runs only on the server that serves this app or comes with the desktop app. A
  browser connected only to remote environments does not show the tab.
- The official T3 Code mobile app shows the assistant's chat under **No project**, and draft cards
  appear there as plain tool calls.
- Clock-out reminders need T3 Code open on the desktop or in a browser.
