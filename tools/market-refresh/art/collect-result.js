// Run after a collect-*.js snippet in the same tab. Waits up to 40 s for the collector to finish and returns its JSON,
// or "still running" (run this again). Plain ASCII only.
window.__mrJob ? await Promise.race([window.__mrJob, new Promise(function (r) { setTimeout(function () { r('still running - run collect-result.js again'); }, 40000); })]) : 'no collector started in this tab';
