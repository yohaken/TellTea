import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const js = `(function(){
  const ed = document.querySelector('.cm-editor');
  if(ed && ed.cmView && ed.cmView.view) {
    const doc = ed.cmView.view.state.doc.toString();
    return 'cmView len='+doc.length+' staff='+(doc.includes('staffOwnsEmployee')?'yes':'no');
  }
  const n = document.querySelectorAll('.cm-line').length;
  const first = document.querySelector('.cm-line')?.textContent || '';
  return 'lines='+n+' first='+first.slice(0,40);
})()`;

writeFileSync("/tmp/verify-rules.js", js);
writeFileSync(
  "/tmp/verify-rules.applescript",
  `tell application "Google Chrome"
  tell active tab of front window
    return execute javascript (read POSIX file "/tmp/verify-rules.js")
  end tell
end tell`,
);
console.log(execSync("osascript /tmp/verify-rules.applescript", { encoding: "utf8" }));
