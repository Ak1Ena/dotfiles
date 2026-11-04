---
name: mail-app-email-report
description: Use when emailing a report or file via Mac Mail.app.
category: email
---

Send through macOS Mail.app with AppleScript only when the user asks for an email in the current turn. Never email PR status, approvals, questions, or test results unprompted; the user has rejected unsolicited status emails. Attach the file(s) whenever the recipient cannot open a link.

- Starter: `templates/send-report.applescript`. Copy it to a scratch dir, not the repo. Run: `osascript SCRATCH/send-report.applescript RECIPIENT "SUBJECT" "BODY" FILE1 [FILE2 ...]`. Recipient is argv 1; every argument after the body is an attachment.
- "After finish" or "send when done" means the send is the last step. Finish every edit, re-render, and check the final files, then send those versions. Never send a draft and then a fix.
- HTML templates: the message body is plain text. Mail.app does not show HTML as the body. Attach the rendered `.html` file (plus a PNG of it when the reader needs the layout) and say so in the body.
- Before the send, run a sensitive-data audit on the exact files: text (emails, phone numbers, URLs, internal repo or code names, client names), every embedded image at full resolution (window headers, address bars, emails visible in screenshots), and the docProps metadata. A sent message cannot be recalled, so the audit gates the send.
- Verify before reporting success. Do not hard-code mailbox names: loop over every account's mailboxes and match names containing "Sent" (localized names exist). Outbox should be 0, and the Sent copy should show the subject, recipient, and `count of mail attachments` equal to the number of files. The multi-attachment loop is new: confirm the count on first use.
- A "not found" on the first check can be a false negative. Re-check after a short wait and across all mailboxes before saying it failed.
- Gmail accounts: `mailbox "Sent Mail" of account "Google"` can fail with -1728 even when the mailbox listing shows "Sent Mail". Iterate `mailboxes of account`, match `name of mb`, then read `messages of mb`.
- Wait with one bounded until-loop (about 90 s, 2 s steps) inside a single command. A `sleep N; osascript` chain can be blocked by the harness.
- If the Sent copy has not appeared after the bounded wait, check Drafts too: a send Mail rejects (for example a bad To address) lands there silently while `osascript` still exits 0. Found in Drafts means it was not sent; fix the cause and send again. Otherwise say the send is unconfirmed, do not resend, and ask the user to check the mailbox first.
- The on-disk `templates/send-report.applescript` must match the `files:` copy below. If they differ, the on-disk file is stale: read its `argv` comment before running it.
- Report only what was verified. If the Sent check has not run, say the message was handed to Mail.
files:
  templates/send-report.applescript: |
    on run argv
      -- argv: 1 recipient, 2 subject, 3 body text, 4.. file paths
      if (count of argv) < 3 then error "usage: osascript send-report.applescript RECIPIENT SUBJECT BODY [FILE ...]"
      set theTo to item 1 of argv
      -- Guard: a wrong argument order once put the subject in the To field and the message silently landed in Drafts.
      if theTo does not contain "@" or theTo contains " " then error "argv 1 must be the recipient email address, got: " & theTo
      set theSubject to item 2 of argv
      set theBody to item 3 of argv
      tell application "Mail"
        set msg to make new outgoing message with properties {subject:theSubject, content:theBody, visible:false}
        tell msg
          make new to recipient at end of to recipients with properties {address:theTo}
          repeat with i from 4 to count of argv
            tell content to make new attachment with properties {file name:(POSIX file (item i of argv))} at after the last paragraph
          end repeat
        end tell
        delay 2
        send msg
      end tell
    end run
