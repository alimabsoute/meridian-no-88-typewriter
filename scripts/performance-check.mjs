import {
  DEFAULT_PREVIEW_URL,
  ensurePreviewServer,
  launchBrowser,
  withQuality,
} from './browser-test-helpers.mjs';

const configuredTargetUrl = process.env.TARGET_URL || withQuality(DEFAULT_PREVIEW_URL, 'default');
const preview = await ensurePreviewServer({ targetUrl: configuredTargetUrl });
const defaultUrl = withQuality(preview.targetUrl, 'default');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  return errors;
}

function metricMap(payload) {
  return Object.fromEntries(payload.metrics.map(({ name, value }) => [name, value]));
}

async function openSimulator(page, targetUrl) {
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60_000 });
  await page.click('#enter-studio');
  await page.waitForTimeout(900);
}

async function sampleRaf(page, label, configure) {
  await page.evaluate(configure);
  await page.waitForTimeout(300);
  return page.evaluate((sampleLabel) => new Promise((resolve) => {
    let frames = 0;
    let first = 0;
    function frame(now) {
      if (!first) first = now;
      frames += 1;
      if (frames >= 45) {
        const averageFrameMs = (now - first) / (frames - 1);
        resolve({ label: sampleLabel, averageFrameMs, fps: Math.round(1000 / averageFrameMs) });
      } else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), label);
}

async function sampleCpu(page, session, label, configure, durationMs = 1_400) {
  await page.evaluate(configure);
  await page.waitForTimeout(350);
  const before = metricMap(await session.send('Performance.getMetrics'));
  const wallStart = performance.now();
  await page.waitForTimeout(durationMs);
  const wallSeconds = (performance.now() - wallStart) / 1_000;
  const after = metricMap(await session.send('Performance.getMetrics'));
  const deltaMilliseconds = (name) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1_000;
  const taskMs = deltaMilliseconds('TaskDuration');
  const scriptMs = deltaMilliseconds('ScriptDuration');
  const layoutMs = deltaMilliseconds('LayoutDuration');
  const styleMs = deltaMilliseconds('RecalcStyleDuration');
  return {
    label,
    wallSeconds,
    taskMs,
    scriptMs,
    layoutMs,
    styleMs,
    taskMsPerSecond: taskMs / wallSeconds,
    scriptMsPerSecond: scriptMs / wallSeconds,
  };
}

let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  const session = await context.newCDPSession(page);
  await session.send('Performance.enable');

  try {
    await openSimulator(page, defaultUrl);
    const qualityState = await page.evaluate(() => ({
      ...window.__OCTOBERLINE_211__.room.getState(),
      backdropVisible: window.__OCTOBERLINE_211__.room.backdropMesh.visible,
      environmentVisible: window.__OCTOBERLINE_211__.room.environment.visible,
      exteriorVisible: window.__OCTOBERLINE_211__.room.exterior.visible,
    }));
    invariant(
      qualityState.quality === 'medium'
        && qualityState.effectiveQuality === 'medium'
        && !qualityState.backdropVisible
        && qualityState.environmentVisible
        && !qualityState.exteriorVisible,
      `Default-quality room mismatch: ${JSON.stringify(qualityState)}`,
    );

    const sceneCounts = await page.evaluate(() => {
      const count = (root) => {
        const result = {
          objects: 0,
          meshes: 0,
          visibleDrawables: 0,
          instanced: 0,
          lights: 0,
          visibleLights: 0,
          materials: 0,
        };
        const materials = new Set();
        const effectivelyVisible = (object) => {
          for (let current = object; current; current = current.parent) {
            if (!current.visible) return false;
            if (current === root) break;
          }
          return true;
        };
        root.traverse((object) => {
          result.objects += 1;
          if (object.isMesh || object.isLine || object.isPoints) {
            result.meshes += 1;
            if (effectivelyVisible(object)) result.visibleDrawables += 1;
          }
          if (object.isInstancedMesh) result.instanced += 1;
          if (object.isLight) {
            result.lights += 1;
            if (effectivelyVisible(object)) result.visibleLights += 1;
          }
          const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
          for (const material of list) materials.add(material.uuid);
        });
        result.materials = materials.size;
        return result;
      };
      return {
        machine: count(window.__OCTOBERLINE_211__.model.root),
        room: count(window.__OCTOBERLINE_211__.room.root),
        paper: count(window.__OCTOBERLINE_211__.paperView.root),
        resourceEntries: performance.getEntriesByType('resource').length,
      };
    });
    invariant(
      // The approved scene replaces a six-draw painted backdrop with a bay,
      // instanced living trees and a dimensional city. Keep a finite draw budget.
      sceneCounts.room.visibleDrawables <= 180 && sceneCounts.room.visibleLights <= 3,
      `Dimensional room expanded beyond its draw-resource budget: ${JSON.stringify(sceneCounts.room)}`,
    );

    const updateBenchmark = await page.evaluate(() => {
      const room = window.__OCTOBERLINE_211__.room;
      room.setVisible(true);
      room.setWeatherPreset('snow', { immediate: true });
      const iterations = 600;
      const started = performance.now();
      for (let index = 0; index < iterations; index += 1) room.update(1 / 60, index / 60);
      const durationMs = performance.now() - started;
      return { iterations, durationMs, millisecondsPerUpdate: durationMs / iterations };
    });
    invariant(
      updateBenchmark.millisecondsPerUpdate <= 0.75,
      `Room update CPU budget regressed: ${JSON.stringify(updateBenchmark)}`,
    );

    const cpuSamples = [];
    cpuSamples.push(await sampleCpu(page, session, 'machine-only-a', () => {
      window.__OCTOBERLINE_211__.room.setWeatherPreset('quiet', { immediate: true });
      window.__OCTOBERLINE_211__.room.setVisible(false);
    }));
    cpuSamples.push(await sampleCpu(page, session, 'full-snow', () => {
      window.__OCTOBERLINE_211__.room.setVisible(true);
      window.__OCTOBERLINE_211__.room.setWeatherPreset('snow', { immediate: true });
    }));
    cpuSamples.push(await sampleCpu(page, session, 'full-quiet', () => {
      window.__OCTOBERLINE_211__.room.setWeatherPreset('quiet', { immediate: true });
    }));
    cpuSamples.push(await sampleCpu(page, session, 'machine-only-b', () => {
      window.__OCTOBERLINE_211__.room.setVisible(false);
    }));

    const machineSamples = cpuSamples.filter(({ label }) => label.startsWith('machine-only'));
    const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const machineTaskBaseline = average(machineSamples.map(({ taskMsPerSecond }) => taskMsPerSecond));
    const machineScriptBaseline = average(machineSamples.map(({ scriptMsPerSecond }) => scriptMsPerSecond));
    const fullSnowCpu = cpuSamples.find(({ label }) => label === 'full-snow');
    const environmentTaskOverhead = fullSnowCpu.taskMsPerSecond - machineTaskBaseline;
    const environmentScriptOverhead = fullSnowCpu.scriptMsPerSecond - machineScriptBaseline;
    const taskOverheadLimit = Math.max(25, machineTaskBaseline * 0.35);
    const scriptOverheadLimit = Math.max(16, machineScriptBaseline * 0.4);
    invariant(
      environmentTaskOverhead <= taskOverheadLimit
        && environmentScriptOverhead <= scriptOverheadLimit,
      `Philadelphia room CPU overhead regressed: ${JSON.stringify({
        machineTaskBaseline,
        machineScriptBaseline,
        environmentTaskOverhead,
        environmentScriptOverhead,
        taskOverheadLimit,
        scriptOverheadLimit,
      })}`,
    );

    const rafSamples = [];
    rafSamples.push(await sampleRaf(page, 'full-snow', () => {
      window.__OCTOBERLINE_211__.room.setVisible(true);
      window.__OCTOBERLINE_211__.room.setWeatherPreset('snow', { immediate: true });
    }));
    rafSamples.push(await sampleRaf(page, 'machine-only', () => {
      window.__OCTOBERLINE_211__.room.setVisible(false);
    }));
    const rafCapDetected = rafSamples.every(({ fps }) => fps === rafSamples[0].fps)
      && [30, 60].includes(rafSamples[0].fps);

    const lowContext = await browser.newContext({ viewport: { width: 960, height: 640 } });
    const lowPage = await lowContext.newPage();
    const lowErrors = collectErrors(lowPage);
    let lowQualityState;
    try {
      await openSimulator(lowPage, withQuality(defaultUrl, 'low'));
      lowQualityState = await lowPage.evaluate(() => ({
        ...window.__OCTOBERLINE_211__.room.getState(),
        backdropVisible: window.__OCTOBERLINE_211__.room.backdropMesh.visible,
        environmentVisible: window.__OCTOBERLINE_211__.room.environment.visible,
        exteriorVisible: window.__OCTOBERLINE_211__.room.exterior.visible,
      }));
      invariant(
        lowQualityState.quality === 'low'
          && lowQualityState.effectiveQuality === 'low'
          && !lowQualityState.backdropVisible
          && lowQualityState.environmentVisible
          && !lowQualityState.exteriorVisible
          && !lowErrors.length,
        `Low-quality fallback mismatch: ${JSON.stringify({ lowQualityState, lowErrors })}`,
      );
    } finally {
      await lowContext.close();
    }

    invariant(!errors.length, `Performance browser errors: ${errors.join(' | ')}`);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      defaultUrl,
      qualityState,
      lowQualityState,
      sceneCounts,
      updateBenchmark,
      cpuSamples,
      machineTaskBaseline,
      machineScriptBaseline,
      environmentTaskOverhead,
      environmentScriptOverhead,
      taskOverheadLimit,
      scriptOverheadLimit,
      rafSamples,
      rafCapDetected,
    }, null, 2)}\n`);
  } finally {
    await session.detach().catch(() => {});
    await context.close();
  }
} finally {
  await browser?.close().catch(() => {});
  await preview.close();
}
