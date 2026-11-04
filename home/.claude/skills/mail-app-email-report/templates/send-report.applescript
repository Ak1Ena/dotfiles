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
