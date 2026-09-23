import { enterStudio } from './browser-test-helpers.mjs';
import { DEFAULT_PREVIEW_URL, ensurePreviewServer, launchBrowser, withQuality } from './browser-test-helpers.mjs';
const preview = await ensurePreviewServer({ targetUrl: process.env.TARGET_URL || withQuality(DEFAULT_PREVIEW_URL, 'low') });
const browser = await launchBrowser();
const page = await browser.newPage({viewport:{width:960,height:640}});
async function settle() {
  for(let r=0;r<4;r++) { await page.evaluate(()=> { for(let i=0;i<24;i++) window.__OCTOBERLINE_211__.paperView.update(.05); }); await page.waitForTimeout(0); }
}
async function state() {
 return page.evaluate(()=> { const el=document.querySelector('[data-workbench=paper]'); const s=getComputedStyle(el); const a=window.__OCTOBERLINE_211__; return {app:document.querySelector('#app').className,panel:document.querySelector('#app').dataset.workbenchPanel,display:s.display,visibility:s.visibility,inert:el.closest('[inert]')?.className,rect:el.getBoundingClientRect().toJSON(),phase:a.paperView.phase,captured:a.keyboardCaptured,quiet:a.quietModeEnabled,focused:document.activeElement.id}; });
}
try {
 await page.goto(preview.targetUrl,{waitUntil:'domcontentloaded',timeout:60000});
 await enterStudio(page);
 await page.keyboard.type('Paper handling regression.',{delay:35});
 await page.click('[data-workbench=paper]');
 await page.click('#release-sheet'); await settle();
 await page.click('#keep-sheet'); await settle();
 await page.click('[data-workbench=paper]');
 await page.click('#restore-manuscript'); await settle();
 await page.click('#reinsert-sheet'); await settle();
 console.log('After reinsert', await state());
 await page.screenshot({path:'visual-checks/reinsert-before-reopen.png'});
 await page.click('[data-workbench=paper]');
 console.log('After reopen', await state());
 await page.click('#release-sheet'); await settle();
 await page.click('#keep-sheet'); await settle();
 await page.selectOption('#paper-stock','laid');
 await page.click('#load-sheet'); await settle();
 console.log('After fresh paper', await state());
 await page.keyboard.type('Still writing',{delay:35});
 await page.waitForFunction(()=>window.__OCTOBERLINE_211__.document.toPlainText().includes('Still writing'));
 console.log('PASS fresh paper accepts typing');
} catch(error) { console.log('Failure state', await state()); await page.screenshot({path:'visual-checks/paper-workbench-failure.png'}); throw error; }
finally { await browser.close(); await preview.close(); }
