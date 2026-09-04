import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const js = `(function(){
  const lines=[...document.querySelectorAll('.cm-line')].map(l=>l.textContent).join('\\n');
  return 'len='+lines.length+' staff='+(lines.includes('staffOwnsEmployee')?'yes':'no');
})()`;

writeFileSync("/tmp/read-cm.js", js);
writeFileSync(
  "/tmp/read-cm.applescript",
  `tell application "Google Chrome"
  tell active tab of front window
    return execute javascript (read POSIX file "/tmp/read-cm.js")
  end tell
end tell`,
);
console.log(execSync("osascript /tmp/read-cm.applescript", { encoding: "utf8" }));
