import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.beforeEach(async ({ page }) => {
  // No browser test can mutate the physical heat pump, even if a selector is wrong.
  await page.route('**/api/**', async route => {
    if (['PATCH','PUT','POST','DELETE'].includes(route.request().method())) return route.fulfill({ status: 403, json: { error: 'Testi turvatõke: füüsilisi muudatusi ei saadeta.' } });
    return route.continue();
  });
});

test('live overview, all eight views, no browser exceptions', async ({ page }) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.status-strip .badge')).toContainText('Võrgus');
  await expect(page.getByRole('heading',{name:'Kodu soojusring'})).toBeVisible();
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  for(const [nav,heading] of [['Küte','Küte'],['Tarbevesi','Tarbevesi'],['Ajalugu','Ajalugu'],['Kõik parameetrid','Kõik parameetrid'],['Teavitused','Teavitused'],['Minu seade','Minu seade'],['Seaded ja ühendus','Seaded ja ühendus']]) {
    await page.getByRole('navigation').getByRole('button',{name:nav,exact:true}).click();
    await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('search, filters, favorites and correctly scaled edit dialog',async({page})=>{
  await page.goto('/?page=parameters');
  await page.getByRole('textbox',{name:'Otsi parameetreid'}).fill('5105');
  const row=page.getByRole('row').filter({hasText:'Tarbevee sihttemperatuur'});
  await expect(row).toHaveCount(1);
  await row.getByRole('button',{name:'Lisa lemmikuks: Tarbevee sihttemperatuur'}).click();
  await expect(row.getByRole('button',{name:'Eemalda lemmikutest: Tarbevee sihttemperatuur'})).toBeVisible();
  await row.getByRole('button',{name:'Muuda'}).click();
  const input=page.getByRole('spinbutton',{name:'Uus väärtus'});
  await expect(input).toHaveAttribute('min','30');await expect(input).toHaveAttribute('max','65');await expect(input).toHaveAttribute('step','0.5');
  await expect(page.getByRole('button',{name:'Salvesta muudatus'})).toBeDisabled();
  await page.getByRole('button',{name:'Suurenda väärtust'}).click();
  await expect(page.getByRole('button',{name:'Salvesta muudatus'})).toBeEnabled();
  await page.keyboard.press('Escape');await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('textbox',{name:'Otsi parameetreid'}).fill('olematu-parameeter');
  await expect(page.getByText('Sobivaid parameetreid ei leitud')).toBeVisible();
});

test('write workflow sends scaled user units; partial failure stays visible',async({page})=>{
  let sent;
  await page.route('**/api/devices/*/points',async route=>{
    if(route.request().method()!=='PATCH')return route.fallback();
    sent=route.request().postDataJSON();
    return route.fulfill({status:200,json:{results:[{id:'5105',status:'rejected',success:false}],allModified:false}});
  });
  await page.goto('/?page=parameters');
  await page.getByRole('textbox',{name:'Otsi parameetreid'}).fill('5105');
  await page.getByRole('row').filter({hasText:'Tarbevee sihttemperatuur'}).getByRole('button',{name:'Muuda'}).click();
  await page.getByRole('spinbutton',{name:'Uus väärtus'}).fill('45.5');
  await page.getByRole('button',{name:'Salvesta muudatus'}).click();
  await expect(page.getByRole('alert')).toContainText('myUplink ei kinnitanud muudatust');
  expect(sent).toEqual({'5105':'45.5'});
});

test('zone dialog uses dedicated zone endpoint',async({page})=>{
  let sent;
  await page.route('**/api/devices/*/zones/*',async route=>{
    if(route.request().method()!=='PATCH')return route.fallback();
    sent=route.request().postDataJSON();
    return route.fulfill({status:200,json:{result:{'5105':'modified'}}});
  });
  await page.goto('/?page=water');
  const zone=page.locator('.zone-card').filter({hasText:'Tarbeveetootmine'});
  await zone.getByRole('button',{name:'Tsooni seadistused'}).click();
  await page.getByRole('spinbutton').fill('46.5');
  await page.getByRole('button',{name:'Salvesta muudatus'}).click();
  await expect(page.getByRole('status')).toContainText('Käsk on myUplinkile saadetud');
  expect(sent).toEqual({setpointHeat:46.5});
});

test('notifications, measured history and CSV',async({page,request})=>{
  await page.goto('/?page=alarms');
  await expect(page.getByText('Aktiivseid häireid pole',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Kõik sündmused'}).click();
  await expect(page.locator('.alarm-row').first()).toBeVisible();
  const systems=await(await request.get('/api/systems')).json();const id=systems[0].devices[0].id;
  const history=await(await request.get(`/api/history/${id}?hours=24`)).json();
  expect(history.rows.length).toBeGreaterThan(0);expect(history.source).toBe('local');
  const csv=await request.get(`/api/history/${id}?hours=24&format=csv`);
  expect(csv.headers()['content-type']).toContain('text/csv');expect(await csv.text()).toContain('Aeg;Parameeter;Nimetus;Väärtus;Ühik');
  // Suur eksport (üle 64 KB) peab lõpuni jõudma: varem jäi vastus drain-sündmuse taha seisma.
  const big=await request.get(`/api/history/${id}?hours=8760&format=csv`,{timeout:20000});const text=await big.text();
  expect(text.length).toBeGreaterThan(70000);expect(text.trimEnd().split('\n').length).toBeGreaterThan(1000);
});

test('server blocks cross-origin writes and invalid control values',async({request})=>{
  const systems=await(await request.get('/api/systems')).json();const id=systems[0].devices[0].id;
  const blocked=await request.patch(`/api/devices/${id}/points`,{data:{'5105':'45.5'},headers:{origin:'https://example.com','x-soojus-request':'1'}});
  expect(blocked.status()).toBe(403);
  const invalid=await request.patch(`/api/devices/${id}/points`,{data:{'5105':'455'},headers:{origin:'http://localhost:3210','x-soojus-request':'1'}});
  expect(invalid.status()).toBe(400);expect((await invalid.json()).error).toContain('65');
  const readonly=await request.patch(`/api/devices/${id}/points`,{data:{'0':'30'},headers:{origin:'http://localhost:3210','x-soojus-request':'1'}});
  expect(readonly.status()).toBe(403);
  const status=await(await request.get('/api/status')).text();expect(status).not.toContain('clientSecret');expect(status).not.toContain('access_token');
});

test('mobile layout and navigation stay within viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.locator('.status-strip .badge')).toContainText('Võrgus');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Ava menüü'}).click();
  await page.getByRole('navigation').getByRole('button',{name:'Tarbevesi',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Tarbevesi',exact:true})).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('visibility','hidden');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
});

test('heating curve page shows the fitted curve, current point and offset control', async ({ page }) => {
  await page.goto('/?ui=next&page=curve');
  await expect(page.getByRole('heading', { name: 'Küttekõver', exact: true })).toBeVisible();
  await expect(page.locator('.en-card')).toHaveCount(5);
  await expect(page.locator('.curve-chart')).toBeVisible();
  await expect(page.locator('.curve-offset input[type="range"]')).toBeVisible();
});

test('energy page shows daily heat, electricity, COP, cost and exports CSV', async ({ page }) => {
  await page.goto('/?ui=next&page=energy');
  await expect(page.getByRole('heading', { name: 'Energia ja kulu', exact: true })).toBeVisible();
  await expect(page.locator('.en-card')).toHaveCount(6);
  await expect(page.locator('.en-card').filter({ hasText: 'Toodetud soojus' })).toContainText(/kWh/);
  await expect(page.locator('.en-card').filter({ hasText: 'COP' })).toContainText(/\d/);
  await expect(page.locator('.en-cop-note')).toContainText('1 kWh elektri eest saadi 3,5 kWh soojust');
  await expect(page.locator('.en-table:not(.en-compare) tbody tr').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pakettide võrdlus' })).toBeVisible();
  await page.getByRole('button', { name: 'Kahetariifne', exact: true }).click();
  await expect(page.locator('.en-table:not(.en-compare) thead')).toContainText('Päevane, kWh');
  await expect(page.locator('.en-table:not(.en-compare) thead')).toContainText('Öine, kWh');
  await expect(page.locator('.en-card').filter({ hasText: 'Kulu' })).not.toContainText('—');
  await page.getByRole('button', { name: 'Arve järgi', exact: true }).click();
  await expect(page.locator('.en-tariff-foot')).toContainText('0,2266');
  await page.locator('.en-check input').check();
  await expect(page.locator('.en-card').filter({ hasText: 'Kulu' })).toContainText('kuutasu');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Ekspordi CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('soojus-energia-30p.csv');
});

test('history supports explicit windows, zoom by dragging and previous-period comparison',async({page,request})=>{
  const systems=await(await request.get('/api/systems')).json();const id=systems[0].devices[0].id;
  const to=new Date(),from=new Date(to.getTime()-6*3600000);
  const win=await(await request.get(`/api/history/${id}?from=${from.toISOString()}&to=${to.toISOString()}`)).json();
  expect(win.since).toBe(from.toISOString());expect(win.bucketSeconds).toBe(60);
  for(const r of win.rows)expect(Date.parse(r.time)).toBeLessThan(to.getTime());
  await page.goto('/?page=history');
  await expect(page.locator('.chart-canvas')).toBeVisible();
  const compare=page.getByRole('button',{name:/Võrdle eelmise perioodiga/});
  await compare.click();await expect(compare).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('columnheader',{name:'Eelmine keskmine'})).toBeVisible();
  const box=await page.locator('.chart-canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.7,box.y+box.height/2,{steps:5});await page.mouse.up();
  const reset=page.getByRole('button',{name:/Lähtesta suum/});await expect(reset).toBeVisible();
  await reset.click();await expect(reset).toHaveCount(0);
});

test('new Kodu-plaan interface can be switched on and off and keeps working controls', async ({ page }) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.removeItem('soojus.ui'));
  await page.goto('/?page=settings');
  await page.getByRole('button',{name:'Uus · Kodu-plaan'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-ui','next');
  await expect(page.getByRole('navigation',{name:'Põhinavigatsioon'}).getByRole('button',{name:'Tarbevesi'})).toBeVisible();
  await page.getByRole('navigation',{name:'Põhinavigatsioon'}).getByRole('button',{name:'Kodu'}).click();
  await expect(page.getByRole('heading',{name:'Kodu'})).toBeAttached();
  await expect(page.getByText('Viimased 24 tundi')).toBeVisible();
  await page.getByRole('navigation',{name:'Põhinavigatsioon'}).getByRole('button',{name:'Tarbevesi'}).click();
  await page.getByRole('button',{name:/Muuda: Tarbevee sihttemperatuur/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation',{name:'Põhinavigatsioon'}).getByRole('button',{name:/Veel/}).click();
  await page.getByRole('menuitem',{name:'Seaded ja ühendus'}).click();
  await page.getByRole('button',{name:'Klassikaline',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-ui','classic');
  await expect(page.getByRole('heading',{name:'Seaded ja ühendus'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('new interface fits a phone screen and uses the bottom dock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(()=>localStorage.setItem('soojus.ui','next'));
  await page.goto('/');
  await expect(page.getByRole('navigation',{name:'Kiirnavigatsioon'})).toBeVisible();
  await expect(page.locator('.live.is-embedded .live-stage canvas')).toBeVisible();
  await expect(page.locator('.live-temps')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('navigation',{name:'Kiirnavigatsioon'}).getByRole('button',{name:'Veel'}).click();
  await expect(page.getByRole('menuitem',{name:'Minu seade'})).toBeVisible();
  await page.getByRole('menuitem',{name:'Minu seade'}).click();
  await expect(page.getByRole('heading',{name:'Minu seade',level:1})).toBeVisible();
});

const ventFixture = { configured: true, host: '192.168.100.2', time: new Date().toISOString(), error: null, mode: 'auto', modeText: 'Automaatne', errors: [],
  data: { firmware: 544, temperatures: { extract: 22.8, supply: 21.2, outside: 15.7, exhaust: null, extra: null }, humidity: { extract: 55.2, supply: 54, outside: 70, exhaust: null, extra: null }, co2: 1150, voc: 0, pm25: 6,
    fans: { supplyLevel: 4, extractLevel: 4, supplyRpm: 1302, extractRpm: 1300 }, airflow: { supply: 100, extract: 100 }, heatRecovery: 79, uptimeHours: 100, errorFlags: 0, serverConnected: true,
    settings: { mode: 1, humiditySetpoint: 60, co2Setpoint: 800, manualFanLevel: 3, overpressureFanLevel: 5, boostTimeout: 1800, overpressureTimeout: 1800, filterInterval: 8760, filterElapsed: 8000, vocSetpoint: 200, pmSetpoint: 100 },
    switches: { power: true, bypass: false, boost: false, overpressure: false, filterAlert: true, humidityControl: true, vocControl: false, pmControl: false } },
  points: [{ parameterId: 'co2', label: 'CO₂', parameterUnit: 'ppm', value: 1150 }, { parameterId: 'supply_temp', label: 'Sissepuhke temperatuur', parameterUnit: '°C', value: 21.2 }] };

test('ventilation page shows readings, warnings and the setup form in both interfaces', async ({ page }) => {
  await page.route('**/api/airobot', route => route.request().method() === 'GET' ? route.fulfill({ json: ventFixture }) : route.continue());
  await page.goto('/?page=ventilation');
  await expect(page.getByText('Automaatne, kiirus 4/10, õhu kvaliteet kõrge (CO₂ 1150 ppm).')).toBeVisible();
  await expect(page.getByText('Filter vajab vahetust')).toBeVisible();
  await expect(page.getByText('1302 p/min')).toBeVisible();
  await page.addInitScript(()=>localStorage.setItem('soojus.ui','next'));
  await page.reload();
  await expect(page.getByRole('heading',{name:'Ventilatsioon',level:1})).toBeVisible();
  await page.getByRole('navigation',{name:'Põhinavigatsioon'}).getByRole('button',{name:'Kodu'}).click();
  await expect(page.getByText('Ventilatsiooni filter vajab vahetust.')).toBeVisible();
  await expect(page.locator('.live.is-embedded .live-status')).toContainText('kiirus 4/10');
  await expect(page.locator('.live.is-embedded .live-status')).toContainText('CO₂ 1150 ppm');
  await expect(page.locator('.live.is-embedded .live-modes')).toHaveCount(0);
});

test('unconfigured ventilation offers the Modbus setup and rejects public addresses', async ({ page }) => {
  await page.route('**/api/airobot', route => route.request().method() === 'GET' ? route.fulfill({ json: { configured: false, host: null, points: [], errors: [], data: null } }) : route.continue());
  await page.goto('/?page=ventilation');
  await expect(page.getByText('Ühenda Airobot ventilatsiooniseade')).toBeVisible();
  await expect(page.getByText('Menu → Settings → Other → Modbus TCP')).toBeVisible();
  const res = await page.request.post('/api/airobot', { data: { host: '8.8.8.8' }, headers: { 'X-Soojus-Request': '1', Origin: 'http://localhost:3210' } });
  expect(res.status()).toBe(400);
});

test('ventilation control sends validated payloads for every mode', async ({ page }) => {
  const sent = [];
  await page.route('**/api/airobot', route => route.request().method() === 'GET' ? route.fulfill({ json: ventFixture }) : route.continue());
  await page.route('**/api/airobot/control', route => { sent.push(route.request().postDataJSON()); route.fulfill({ json: { ...ventFixture, mode: sent.at(-1).mode, modeText: 'x' } }); });
  await page.goto('/?page=ventilation');
  const modes = page.getByRole('radiogroup', { name: 'Ventilatsiooni režiim' });
  await expect(modes.getByRole('radio', { name: /Automaatne/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('CO₂ piirmäär ppm').fill('1000');
  await page.getByRole('button', { name: 'Rakenda' }).click();
  await modes.getByRole('radio', { name: /Manuaalne/ }).click();
  await page.getByRole('radiogroup', { name: 'Ventilaatori kiirus' }).getByRole('radio', { name: '7', exact: true }).click();
  await page.getByRole('button', { name: 'Rakenda' }).click();
  await modes.getByRole('radio', { name: /Õhutus/ }).click();
  await page.getByRole('button', { name: '30', exact: true }).click();
  await page.getByRole('button', { name: 'Rakenda' }).click();
  await modes.getByRole('radio', { name: /Ülerõhk/ }).click();
  await page.getByLabel(/või sisesta minutites/).fill('12');
  await page.getByRole('button', { name: 'Rakenda' }).click();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent).toEqual([{ mode: 'auto', co2Setpoint: 1000 }, { mode: 'manual', fanLevel: 7 }, { mode: 'boost', minutes: 30 }, { mode: 'overpressure', minutes: 12 }]);
});

test('server rejects invalid ventilation control input before touching the device', async ({ page }) => {
  const post = body => page.request.post('/api/airobot/control', { data: body, headers: { 'X-Soojus-Request': '1', Origin: 'http://localhost:3210' } });
  for (const bad of [{ mode: 'turbo' }, { mode: 'auto', co2Setpoint: 100 }, { mode: 'manual', fanLevel: 11 }, { mode: 'boost', minutes: 1 }]) expect((await post(bad)).status()).toBe(400);
});

test('ventilation settings switch the summer bypass and other options with validated payloads', async ({ page }) => {
  const sent = [];
  await page.route('**/api/airobot', route => route.request().method() === 'GET' ? route.fulfill({ json: ventFixture }) : route.continue());
  await page.route('**/api/airobot/settings', route => { sent.push(route.request().postDataJSON()); route.fulfill({ json: ventFixture }); });
  await page.goto('/?page=ventilation');
  const toggle = page.locator('.vent-settings-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('switch')).toHaveCount(0);
  const order = await page.evaluate(() => { const y = s => document.querySelector(s).getBoundingClientRect().top; return [y('.vent-control'), y('.vent-trend'), y('.vent-settings')]; });
  expect(order[0]).toBeLessThan(order[1]); expect(order[1]).toBeLessThan(order[2]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('switch', { name: 'Suvine möödaviik' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: 'Suvine möödaviik' }).click();
  await page.getByRole('switch', { name: 'Niiskuse juhtimine' }).click();
  await page.getByLabel('Niiskuse sihttase').fill('55');
  await page.getByRole('button', { name: 'Salvesta' }).click();
  await page.getByRole('radiogroup', { name: 'Ülerõhu kiirus' }).getByRole('radio', { name: '8', exact: true }).click();
  await expect(page.getByText(/Kasutatud 333 päeva \(10,9 kuud\), 91%\. Jäänud 32 päeva \(1,1 kuud\)\./)).toBeVisible();
  await page.getByLabel('Filtri kasutusintervall päevades').fill('180');
  await expect(page.getByText('(5,9 kuud)')).toBeVisible();
  await page.locator('.vent-row', { hasText: 'Filtri kasutusintervall' }).getByRole('button', { name: 'Salvesta' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Filter vahetatud' }).click();
  await expect.poll(() => sent.length).toBe(6);
  expect(sent).toEqual([{ bypass: true }, { humidityControl: false }, { humiditySetpoint: 55 }, { overpressureFanLevel: 8 }, { filterInterval: 4320 }, { resetFilter: true }]);
  await expect(page.getByRole('switch', { name: 'VOC juhtimine' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'PM2,5 juhtimine' })).toHaveAttribute('aria-checked', 'false');
});

test('indoor versus outdoor chart is offered on the ventilation page and validated on the server', async ({ page, request }) => {
  await page.route('**/api/airobot', route => route.request().method() === 'GET' ? route.fulfill({ json: ventFixture }) : route.continue());
  await page.goto('/?page=ventilation');
  await expect(page.getByRole('button', { name: 'Toas vs väljas', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.vent-trend .chart-legend')).toContainText('Toas (ventilatsioon)');
  await expect(page.locator('.vent-trend .chart-legend')).toContainText('Väljas (soojuspump)');
  const systems = await (await request.get('/api/systems')).json(), id = systems[0].devices[0].id;
  expect((await request.get(`/api/history/climate?hours=24&pump=${id}&outdoor=bad!id`)).status()).toBe(400);
  expect((await request.get('/api/history/climate?hours=24&pump=nope&outdoor=5')).status()).toBe(404);
  const ok = await (await request.get(`/api/history/climate?hours=24&pump=${id}&outdoor=5`)).json();
  expect(new Set(ok.rows.map(r => r.point))).toEqual(new Set(['indoor', 'outdoor']));
});

test('history page mixes heat pump and ventilation series and exports them together', async ({ page, request }) => {
  await page.route('**/api/airobot', route => route.request().method() === 'GET' ? route.fulfill({ json: ventFixture }) : route.continue());
  await page.goto('/?page=history');
  await expect(page.getByText('Ventilatsioon (Airobot)', { exact: true })).toBeVisible();
  const mixRequest = page.waitForRequest(r => r.url().includes('/api/history/mix') && !r.url().includes('format=csv'));
  await page.locator('.point-picker button', { hasText: /^Sissepuhke temperatuur/ }).click();
  const url = new URL((await mixRequest).url());
  expect(url.searchParams.get('pump')).toBeTruthy();
  expect(url.searchParams.get('s').split(',')).toEqual(expect.arrayContaining(['p:0', 'a:supply_temp']));
  await expect(page.getByRole('link', { name: 'Ekspordi CSV' })).toHaveAttribute('href', /\/api\/history\/mix\?.*format=csv/);
  await expect(page.locator('.chart-legend')).toContainText('Sissepuhke temperatuur');
  // CO₂ on teise ühikuga: valik algab uuesti ainult sellest
  await page.locator('.point-picker button', { hasText: /^CO₂/ }).click();
  await expect(page.locator('.point-picker button.selected')).toHaveCount(1);
  const systems = await (await request.get('/api/systems')).json(), id = systems[0].devices[0].id;
  const mix = await (await request.get(`/api/history/mix?hours=24&pump=${id}&s=p:5,a:co2`)).json();
  expect(new Set(mix.rows.map(r => r.point))).toEqual(new Set(['p:5', 'a:co2']));
  const csv = await request.get(`/api/history/mix?hours=24&pump=${id}&s=p:5,a:co2&format=csv`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const text = await csv.text();
  expect(text).toContain('"p:5"'); expect(text).toContain('"a:co2"');
  for (const bad of ['x:1', '', 'p:5;drop']) expect((await request.get(`/api/history/mix?hours=24&pump=${id}&s=${encodeURIComponent(bad)}`)).status()).toBe(400);
  expect((await request.get('/api/history/mix?hours=24&pump=nope&s=p:5')).status()).toBe(404);
});

test('Elav kodu renders a live canvas, reacts to demo modes and the clock slider without errors', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
  await page.goto('/?page=live');
  const canvas = page.locator('.live-stage canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elav kodu', level: 1 })).toBeVisible();
  const painted = () => canvas.evaluate(c => { const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data; let colours = new Set(), n = 0; for (let i = 0; i < d.length; i += 4 * 97) { colours.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); n++; } return colours.size; });
  expect(await painted()).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Kõik korraga' }).click();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  await expect(page.getByText(/Pump kütab maja ja tarbevett/)).toBeVisible();
  const slider = page.getByLabel('Kellaaeg tundides');
  await slider.fill('2'); await expect(page.locator('.live-clock b')).toHaveText('02:00');
  await slider.fill('13'); await expect(page.locator('.live-clock b')).toHaveText('13:00');
  await page.waitForTimeout(700);
  expect(await painted()).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Praegu' }).click();
  await page.getByRole('button', { name: 'Päris andmed' }).click();
  await expect(page.getByText('DEMO', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Elav kodu taustamuusika: sisse/välja nupp, helitugevus ja 60 s pausita silmus', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // Ajutine lugu kaustas dist/audio — nii saab testida loo vahetust ka siis, kui sisse ehitatud lugusid on vähe.
  const dir = path.join(process.cwd(), 'dist/audio'), own = path.join(dir, 'e2e-lugu-test.mp3');
  fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(path.join(dir, 'hubane-lounge.mp3'), own);
  try {
    await page.addInitScript(() => {
      localStorage.setItem('soojus.ui', 'next'); if (!sessionStorage.getItem('fresh')) { localStorage.removeItem('soojus.sound.volume'); localStorage.removeItem('soojus.sound.track'); localStorage.removeItem('soojus.sound.mode'); sessionStorage.setItem('fresh', '1'); } window.__sources = [];
      const make = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () { const s = make.call(this); window.__sources.push(s); return s; };
    });
    await page.goto('/?page=live');
    const toggle = page.getByRole('button', { name: /taustamuusika sisse/ }), volume = page.getByLabel('Helitugevus');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.__sources.length)).toBe(0);
    await toggle.click();
    const off = page.getByRole('button', { name: 'Lülita taustamuusika välja' });
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.__sources.length)).toBe(1);
    const info = await page.evaluate(() => { const s = window.__sources[0]; return { loop: s.loop, seconds: s.buffer.duration, end: s.loopEnd }; });
    expect(info.loop).toBe(true); expect(info.seconds).toBeGreaterThan(59.9); expect(info.seconds).toBeLessThan(60.1);
    const select = page.getByLabel('Lugu', { exact: true });
    await expect(select.locator('option', { hasText: 'E2e lugu test' })).toHaveCount(1);
    await select.selectOption('file:e2e-lugu-test.mp3');
    await expect.poll(() => page.evaluate(() => window.__sources.length)).toBe(2);
    const second = await page.evaluate(() => { const s = window.__sources[1]; return { loop: s.loop, seconds: s.buffer.duration }; });
    expect(second.loop).toBe(true); expect(second.seconds).toBeGreaterThan(59.9); expect(second.seconds).toBeLessThan(60.1);
    const pauseBtn = page.getByRole('button', { name: 'Peata muusika pausile' });
    await pauseBtn.click();
    await expect.poll(() => page.evaluate(() => window.__sources.at(-1).context.state)).toBe('suspended');
    const frozen = await page.evaluate(() => window.__sources.at(-1).context.currentTime);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__sources.at(-1).context.currentTime)).toBe(frozen);
    await page.getByRole('button', { name: 'Jätka muusikat' }).click();
    await expect.poll(() => page.evaluate(() => window.__sources.at(-1).context.state)).toBe('running');
    expect(await page.evaluate(() => window.__sources.length)).toBe(2);
    const mode = page.locator('.live-sound-mode');
    await expect(mode).toHaveAttribute('data-mode', 'one');
    await mode.click();
    await expect(mode).toHaveAttribute('data-mode', 'all');
    expect(await page.evaluate(() => window.__sources.at(-1).loop)).toBe(false);
    await mode.click();
    expect(await page.evaluate(() => window.__sources.at(-1).loop)).toBe(true);
    await volume.fill('0.25');
    expect(await page.evaluate(() => localStorage.getItem('soojus.sound.volume'))).toBe('0.25');
    await off.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(page.getByLabel('Helitugevus')).toHaveValue('0.25');
    await expect(page.getByLabel('Lugu', { exact: true })).toHaveValue('file:e2e-lugu-test.mp3');
    expect(await page.evaluate(() => window.__sources.length)).toBe(0);
    expect(errors).toEqual([]);
  } finally { fs.rmSync(own, { force: true }); }
});

test('Elav kodu taustamuusika leiab dist/audio kataloogi lisatud failid', async ({ page }) => {
  const dir = path.join(process.cwd(), 'dist/audio'), file = path.join(dir, 'e2e-oma_lugu.mp3');
  fs.copyFileSync(path.join(dir, 'hubane-lounge.mp3'), file);
  try {
    await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
    await page.goto('/?page=live');
    await expect(page.getByLabel('Lugu', { exact: true }).locator('option', { hasText: 'E2e oma lugu' })).toHaveCount(1);
    fs.rmSync(file);
    await page.waitForTimeout(1700);
    await page.getByLabel('Lugu', { exact: true }).focus();
    await expect(page.getByLabel('Lugu', { exact: true }).locator('option', { hasText: 'E2e oma lugu' })).toHaveCount(0, { timeout: 8000 });
  } finally { fs.rmSync(file, { force: true }); }
});

const soundSpy = () => {
  localStorage.setItem('soojus.ui', 'next'); window.__sources = []; window.__starts = [];
  const make = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function () { const s = make.call(this); window.__sources.push(s); const st = s.start; s.start = function (...a) { window.__starts.push(a[1] ?? 0); return st.apply(this, a); }; return s; };
};

test('muusika ei katke Kodu ja Elava kodu lehe vahel liikudes ning sama muusikanupp näitab sama seisu', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('fresh')) { sessionStorage.setItem('fresh', '1'); localStorage.clear(); } });
  await page.addInitScript(soundSpy);
  await page.goto('/');
  await page.getByRole('button', { name: /taustamuusika sisse/ }).click();
  await expect(page.getByRole('button', { name: /taustamuusika välja/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => window.__sources[0].context.currentTime);
  await page.getByRole('button', { name: 'Demo ja ilmaprognoos' }).click();
  await expect(page.locator('.live-modes')).toBeVisible();
  await expect(page.getByRole('button', { name: /taustamuusika välja/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({ n: window.__sources.length, state: window.__sources[0].context.state, t: window.__sources[0].context.currentTime }));
  expect(after.n).toBe(1); expect(after.state).toBe('running'); expect(after.t).toBeGreaterThan(before + 2);
});

test('muusika sees/pausil seis, koht loos ja helitugevus jäävad lehe uuesti laadimisel meelde', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('fresh')) { sessionStorage.setItem('fresh', '1'); localStorage.clear(); } });
  await page.addInitScript(soundSpy);
  await page.goto('/?page=live');
  await page.getByRole('button', { name: /taustamuusika sisse/ }).click();
  await expect(page.getByRole('button', { name: 'Peata muusika pausile' })).toBeVisible();
  await page.getByLabel('Helitugevus').fill('0.35');
  await page.waitForTimeout(2300);
  await page.getByRole('button', { name: 'Peata muusika pausile' }).click();
  await expect(page.getByRole('button', { name: 'Jätka muusikat' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.live-sound-btn')).toContainText('Pausil');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Jätka muusikat' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Helitugevus')).toHaveValue('0.35');
  expect(await page.evaluate(() => window.__sources.length), 'pausil muusika ei hakka ise mängima').toBe(0);
  await page.getByRole('button', { name: 'Jätka muusikat' }).click();
  await expect(page.getByRole('button', { name: 'Peata muusika pausile' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__starts.length)).toBe(1);
  const starts = await page.evaluate(() => window.__starts);
  expect(starts.length).toBe(1); expect(starts[0]).toBeGreaterThan(1.5); expect(starts[0]).toBeLessThan(6);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__sources.length), { timeout: 8000 }).toBe(1);
  await expect(page.getByRole('button', { name: /taustamuusika välja/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__starts[0])).toBeGreaterThan(1.5);
  await page.mouse.click(5, 5);
  await expect.poll(() => page.evaluate(() => window.__sources[0].context.state)).toBe('running');
  await page.getByRole('button', { name: /taustamuusika välja/ }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /taustamuusika sisse/ })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__sources.length)).toBe(0);
});

test('Elav kodu respects reduced motion by painting a still frame', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
  await page.goto('/?page=live');
  const canvas = page.locator('.live-stage canvas');
  await expect(canvas).toBeVisible(); await page.waitForTimeout(800);
  const snap = () => canvas.evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 13) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h; });
  const a = await snap(); await page.waitForTimeout(1200); const b = await snap();
  expect(a).toBe(b);
  await context.close();
});

test('location can be searched, chosen and reset from the settings page', async ({ page }) => {
  let place = { name: 'Tallinn', latitude: 59.437, longitude: 24.754, isDefault: true };
  const weather = () => ({ location: place, source: 'Open-Meteo', stale: false, error: null, weather: { temperature: 14.8, code: 3, cloud: 93, wind: 2.3, windDirection: 82, days: [] } });
  await page.route('**/api/weather', route => route.fulfill({ json: weather() }));
  await page.route('**/api/location/search**', route => route.fulfill({ json: { results: [{ name: 'Ülenurme', latitude: 58.3162, longitude: 26.72517, region: 'Kambja vald, Eesti Vabariik', countryCode: 'EE' }] } }));
  let saved = null;
  await page.route('**/api/location', route => { const r = route.request(); if (r.method() === 'POST') { saved = r.postDataJSON(); place = { ...saved, isDefault: false }; return route.fulfill({ json: place }); } if (r.method() === 'DELETE') { place = { name: 'Tallinn', latitude: 59.437, longitude: 24.754, isDefault: true }; return route.fulfill({ json: place }); } return route.fulfill({ json: place }); });
  await page.goto('/?page=settings');
  await expect(page.getByText('Asukoht ja ilm')).toBeVisible();
  await expect(page.getByText(/Praegu: Tallinn/)).toBeVisible();
  await expect(page.getByText(/14,8 °C, pilves, tuul 2,3 m\/s idatuul/)).toBeVisible();
  await page.getByLabel('Otsi asukohta').fill('Ülenurme');
  await page.getByRole('button', { name: 'Otsi', exact: true }).click();
  await page.getByRole('button', { name: /Ülenurme.*Kambja vald/ }).click();
  await expect.poll(() => saved).toEqual({ name: 'Ülenurme', latitude: 58.3162, longitude: 26.72517 });
  await expect(page.getByText(/Praegu: Ülenurme/)).toBeVisible();
  await page.getByRole('button', { name: 'Sisesta koordinaadid käsitsi' }).click();
  await page.getByLabel('Nimi', { exact: true }).fill('Minu maja'); await page.getByLabel('Laiuskraad').fill('58.35'); await page.getByLabel('Pikkuskraad').fill('26.7');
  await page.getByRole('button', { name: 'Salvesta asukoht' }).click();
  await expect.poll(() => saved?.name).toBe('Minu maja');
  await page.getByRole('button', { name: 'Lähtesta vaikeasukohale' }).click();
  await expect(page.getByText(/Praegu: Tallinn/)).toBeVisible();
});

test('server validates and protects the location endpoints', async ({ request }) => {
  const headers = { 'X-Soojus-Request': '1', Origin: 'http://localhost:3210' };
  expect((await request.post('/api/location', { data: { name: 'x', latitude: 120, longitude: 0 }, headers })).status()).toBe(400);
  expect((await request.post('/api/location', { data: { name: '', latitude: 1, longitude: 0 }, headers })).status()).toBe(400);
  expect((await request.post('/api/location', { data: { name: 'x', latitude: 1, longitude: 1 } })).status()).toBe(403);
  expect((await request.get('/api/location/search?q=a')).status()).toBe(400);
  const res = await request.get('/api/location'); const p = await res.json();
  expect(Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && typeof p.name === 'string').toBe(true);
  const w = await (await request.get('/api/weather')).json();
  expect(w.source).toBe('Open-Meteo'); expect(w.location.name).toBe(p.name);
});

test('Elav kodu shows the place, weather and forecast and can demo every weather type', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/weather', route => route.fulfill({ json: { location: { name: 'Tartu', latitude: 58.3806, longitude: 26.7251, isDefault: false }, source: 'Open-Meteo', stale: false, error: null, weather: { temperature: 9.4, feelsLike: 6.1, humidity: 88, code: 61, cloud: 100, wind: 6.2, windDirection: 225, precipitation: 1.2, rain: 1.2, showers: 0, snowfall: 0, snowDepth: 0, days: [{ date: '2026-09-30', code: 61, max: 11, min: 6, precipitation: 3.4 }, { date: '2026-10-01', code: 3, max: 10, min: 4, precipitation: 0 }] } } }));
  await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
  await page.goto('/?page=live');
  await expect(page.locator('.live-place')).toContainText('Tartu');
  await expect(page.locator('.live-weather')).toContainText('kerge vihm');
  await expect(page.locator('.live-weather')).toContainText('9,4 °C');
  await expect(page.locator('.wx-tiles')).toContainText('edelatuul');
  await expect(page.locator('.wx-day').first()).toContainText('Täna');
  const canvas = page.locator('.live-stage canvas');
  const sample = () => canvas.evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 211) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h; });
  const seen = new Set();
  for (const name of ['Selge', 'Pilves', 'Vihm', 'Lumi', 'Äike', 'Udu']) {
    await page.getByLabel('Ilma demo').selectOption({ label: name }); await page.waitForTimeout(1600);
    seen.add(await sample());
    await expect(page.locator('.wx-place')).toContainText('DEMO');
  }
  expect(seen.size).toBeGreaterThanOrEqual(5);
  await page.getByRole('button', { name: /^Tartu$/ }).click();
  await expect(page.getByText('Asukoht ja ilm')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Elav kodu devices highlight on hover, explain themselves and open their pages', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
  await page.goto('/?page=live');
  const pump = page.getByRole('button', { name: /^Maasoojuspump\./ }), boiler = page.getByRole('button', { name: /^Veeboiler\./ });
  await expect(pump).toBeVisible();
  const label = pump.locator('.live-hot-label');
  await expect(label).toHaveCSS('opacity', '0');
  await pump.hover();
  await expect(label).toHaveCSS('opacity', '1');
  await expect(label).toContainText('Võtab soojust maapinnast');
  await expect(label).toContainText('Ava leht: Küte');
  await boiler.hover();
  await expect(boiler.locator('.live-hot-label')).toContainText('Hoiab sooja tarbevett');
  await expect(label).toHaveCSS('opacity', '0');
  await boiler.click();
  await expect(page.getByRole('heading', { name: 'Tarbevesi', level: 1 })).toBeVisible();
  await page.goto('/?page=live');
  await page.getByRole('button', { name: /^Maasoojuspump\./ }).click();
  await expect(page.getByRole('heading', { name: 'Küte', level: 1 })).toBeVisible();
  await page.goto('/?page=live');
  await page.getByRole('button', { name: /^Ventilatsioon\./ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Ventilatsioon', level: 1 })).toBeVisible();
});

test('Elav kodu full screen keeps device status and temperatures visible while controls fade', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('soojus.ui', 'next'); let fs = null; Element.prototype.requestFullscreen = function () { fs = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }; document.exitFullscreen = () => { fs = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }; Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fs }); });
  await page.goto('/?page=live');
  await expect(page.locator('.live-status')).toBeVisible();
  await page.getByRole('button', { name: 'Täisekraan' }).click();
  const devices = page.getByRole('group', { name: 'Seadmete seis' });
  await expect(devices).toBeVisible();
  await expect(devices).toContainText('Maasoojuspump'); await expect(devices).toContainText('Ventilatsioon'); await expect(devices).toContainText('Tarbevesi');
  await expect(devices).toContainText('pealevool');
  await expect(page.locator('.live-controls')).toHaveCSS('opacity', '0', { timeout: 8000 });
  await expect(devices).toBeVisible(); await expect(devices).toHaveCSS('opacity', '1');
  await expect(page.locator('.live-temps')).toHaveCSS('opacity', '1');
  await page.mouse.move(300, 300);
  await expect(page.locator('.live-controls')).toHaveCSS('opacity', '1');
});

test('Elav kodu full screen top edge links appear on mouse movement and open Küte, Tarbevesi and Ventilatsioon', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('soojus.ui', 'next'); let fs = null; Element.prototype.requestFullscreen = function () { fs = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }; document.exitFullscreen = () => { fs = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }; Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fs }); });
  const enter = async () => { await page.goto('/?page=live'); await page.getByRole('button', { name: 'Täisekraan' }).click(); };
  await enter();
  const nav = page.getByRole('navigation', { name: 'Kiirlingid lehtedele' });
  await expect(nav).toBeVisible();
  await expect(page.locator('.live-topnav')).toHaveCSS('opacity', '0', { timeout: 8000 });
  await page.mouse.move(400, 300);
  await expect(page.locator('.live-topnav')).toHaveCSS('opacity', '1');
  await nav.getByRole('button', { name: 'Ava leht Küte' }).click();
  await expect(page.getByRole('heading', { name: 'Küte', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBe(null);
  for (const label of ['Tarbevesi', 'Ventilatsioon']) {
    await enter();
    await page.getByRole('button', { name: `Ava leht ${label}` }).click();
    await expect(page.getByRole('heading', { name: label, level: 1 })).toBeVisible();
  }
});

test('Elav kodu full screen hides the brine in/out temperature tags on the ground loop', async ({ page }) => {
  const data = { temperatures: { brineIn: 9.4, brineOut: 6.1, hotGas: 71.2, flow: 35, return: 30 }, inputs: { brineFlow: true, evu: true, motorProtection: true }, outputs: { compressor: true, brinePump: true, heatingPump: true, hotWaterPump: false } };
  const view = { configured: true, host: '192.168.100.171', time: new Date().toISOString(), error: null, data, points: [] };
  await page.route('**/api/luxtronik', route => route.fulfill({ json: view }));
  await page.addInitScript(() => { localStorage.setItem('soojus.ui', 'next'); let fs = null; Element.prototype.requestFullscreen = function () { fs = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }; document.exitFullscreen = () => { fs = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }; Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fs }); });
  await page.goto('/?page=live');
  const canvas = page.locator('.live-stage canvas');
  // Kohtvõrgu sildid on tumedad kaardid, kuid valge tekst segab kogu kaardi keskmist; seepärast loeme kaardi tühja paremat serva.
  const brightness = (x, y, w, h) => canvas.evaluate((c, r) => {
    const rect = c.getBoundingClientRect(), sc = Math.min(rect.width / 1600, rect.height / 960), ox = (rect.width - 1600 * sc) / 2, oy = (rect.height - 960 * sc) / 2 - 60 * sc, dpr = c.width / rect.width, ctx = c.getContext('2d');
    let sum = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const d = ctx.getImageData(Math.round((ox + (r.x + (i + 0.5) / 5 * r.w) * sc) * dpr), Math.round((oy + (r.y + (j + 0.5) / 5 * r.h) * sc) * dpr), 1, 1).data;
      sum += d[0] + d[1] + d[2];
    }
    return sum / 25;
  }, { x, y, w, h });
  const tags = [[1058, 952, 16, 28], [1228, 952, 16, 28]];
  // Oota, kuni kohtvõrgu andmed on kohal ja sildid on päriselt joonistatud (tume kaart, seega heledus alla 95).
  await expect.poll(() => brightness(...tags[0])).toBeLessThan(95);
  const shown = await Promise.all(tags.map(t => brightness(...t)));
  await page.getByRole('button', { name: 'Täisekraan' }).click();
  await page.waitForTimeout(500);
  for (let i = 0; i < tags.length; i++) expect(await brightness(...tags[i]), `silt ${i} peidetud`).toBeGreaterThan(shown[i] + 20);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(500);
  for (let i = 0; i < tags.length; i++) expect(await brightness(...tags[i]), `silt ${i} tagasi`).toBeLessThan(shown[i] + 20);
});

test('Elav kodu full screen shows an always-visible compact weather summary under the info bullets', async ({ page }) => {
  const hourly = Array.from({ length: 24 }, (_, i) => ({ time: `2026-10-03T${String(i).padStart(2, '0')}:00`, temperature: 8 + i * 0.2, code: 61, rainChance: 60, precipitation: 0.3, isDay: i >= 7 && i < 19 }));
  await page.route('**/api/weather', route => route.fulfill({ json: { location: { name: 'Tartu', latitude: 58.3806, longitude: 26.7251, isDefault: false }, source: 'Open-Meteo', stale: false, error: null, weather: { temperature: 9.4, code: 61, cloud: 100, wind: 6.2, isDay: true, days: [{ date: '2026-10-03', code: 61, max: 11, min: 6, precipitation: 3.4, rainChance: 70 }], hourly } } }));
  await page.addInitScript(() => { localStorage.setItem('soojus.ui', 'next'); let fs = null; Element.prototype.requestFullscreen = function () { fs = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }; document.exitFullscreen = () => { fs = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }; Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fs }); });
  await page.goto('/?page=live');
  await expect(page.locator('.live-rail')).toHaveCount(0);
  await page.getByRole('button', { name: 'Täisekraan' }).click();
  const rail = page.locator('.live-rail');
  await expect(rail).toBeVisible();
  await expect(rail).toContainText('Tartu');
  await expect(rail).toContainText('9,4°');
  await expect(rail).toContainText('Prognoos 24 h');
  await expect(rail).toContainText('Kõrgeim');
  await expect(rail).toContainText('Madalaim');
  await expect(rail).toContainText('Sademed');
  // Raud jääb nähtavale ka siis, kui juhtnupud on tegevusetult kadunud.
  await expect(page.locator('.live-controls')).toHaveCSS('opacity', '0', { timeout: 8000 });
  await expect(rail).toBeVisible();
});

test('Elav kodu mängib äikese ajal välgulöögi heli, kui taustamuusika käib', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('soojus.ui', 'next'); window.__sfx = [];
    const f = window.fetch;
    window.fetch = (u, ...a) => { if (String(u).includes('/sfx/lightning')) window.__sfx.push(String(u)); return f(u, ...a); };
  });
  await page.goto('/?page=live');
  await page.getByRole('button', { name: /taustamuusika sisse/ }).click();
  await expect(page.getByRole('button', { name: /taustamuusika välja/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Ilma demo').selectOption({ label: 'Äike' });
  // Esimene välk lööb paari sekundi pärast (storm peab üle 0,5 kerkima + cooldown); seejärel küsib ambience heliefekti.
  await expect.poll(() => page.evaluate(() => window.__sfx.length), { timeout: 25000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__sfx[0])).toContain('/sfx/lightning.mp3');
});

test('Elav kodu mängib vihma ajal vihmaheli, kui taustamuusika käib', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('soojus.ui', 'next'); window.__sfx = [];
    const f = window.fetch;
    window.fetch = (u, ...a) => { if (String(u).includes('/sfx/')) window.__sfx.push(String(u)); return f(u, ...a); };
  });
  await page.goto('/?page=live');
  await page.getByLabel('Ilma demo').selectOption({ label: 'Vihm' });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__sfx.filter(u => u.includes('/rain.mp3')).length), 'ilma muusikata vihmaheli ei mängi').toBe(0);
  await page.getByRole('button', { name: /taustamuusika sisse/ }).click();
  await expect.poll(() => page.evaluate(() => window.__sfx.some(u => u.includes('/rain.mp3'))), { timeout: 15000 }).toBe(true);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 800, height: 900 }, { width: 390, height: 844 }]) {
  test(`Elav kodu click areas sit exactly over the drawn devices at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
    await page.goto('/?page=live');
    await expect(page.locator('.live-hot').first()).toBeAttached();
    await page.waitForTimeout(600);
    const offsets = await page.evaluate(() => {
      const view = document.querySelector('.live-view').getBoundingClientRect(), W = 1600, H = 960, sc = Math.min(view.width / W, view.height / H);
      const ox = view.left + (view.width - W * sc) / 2, oy = view.top + (view.height - H * sc) / 2 - 60 * sc;
      const spots = { Maasoojuspump: [372, 520, 116, 180], Maakontuur: [600, 790, 690, 150], Ventilatsioon: [738, 326, 154, 76], Veeboiler: [1138, 545, 64, 145] };
      return Object.entries(spots).map(([name, [x, y, w, h]]) => {
        const el = [...document.querySelectorAll('.live-hot')].find(e => e.getAttribute('aria-label').startsWith(name + '.'));
        if (!el) return { name, missing: true };
        const r = el.getBoundingClientRect();
        return { name, dx: r.left - (ox + x * sc), dy: r.top - (oy + y * sc), dw: r.width - w * sc, dh: r.height - h * sc };
      });
    });
    for (const o of offsets) { expect(o.missing, o.name).toBeFalsy(); for (const k of ['dx', 'dy', 'dw', 'dh']) expect(Math.abs(o[k]), `${o.name} ${k}`).toBeLessThan(1.5); }
  });
}

test('heat pump local link can be connected in settings and brine values show up in the live view', async ({ page }) => {
  let view = { configured: false, host: null, points: [], data: null, error: null };
  const data = { temperatures: { brineIn: 9.4, brineOut: 6.1, hotGas: 71.2, flow: 35, return: 30 }, inputs: { brineFlow: true, evu: true, motorProtection: true }, outputs: { compressor: true, brinePump: true, heatingPump: true, hotWaterPump: false } };
  await page.route('**/api/luxtronik', async route => {
    const r = route.request();
    if (r.method() === 'POST') { expect(r.postDataJSON()).toEqual({ host: '192.168.100.171' }); view = { configured: true, host: '192.168.100.171', time: new Date().toISOString(), error: null, data, points: [{ parameterId: 'brine_in', label: 'Soojakandja maast (sisse pumpa)', parameterUnit: '°C', value: 9.4 }, { parameterId: 'brine_out', label: 'Soojakandja maasse (pumbast välja)', parameterUnit: '°C', value: 6.1 }] }; return route.fulfill({ json: view }); }
    return route.fulfill({ json: view });
  });
  await page.goto('/?page=settings');
  await expect(page.getByText('Soojuspumba kohtvõrguliides')).toBeVisible();
  await page.getByLabel('Soojuspumba IP-aadress').fill('192.168.100.171');
  await page.getByRole('button', { name: 'Ühenda ja testi' }).click();
  await expect(page.locator('.luxtronik-panel').getByText(/Ühendatud:/)).toBeVisible();
  await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
  await page.goto('/?page=live');
  const ground = page.getByRole('button', { name: /^Maakontuur\./ });
  await ground.hover();
  await expect(ground.locator('.live-hot-label')).toContainText('Soojakandja maast 9,4 °C, maasse 6,1 °C');
  await expect(ground.locator('.live-hot-label')).toContainText('maa andis 3,3 K soojust');
  await page.goto('/?page=history');
  await expect(page.getByText('Soojuspump, kohtvõrk (soojakandja)', { exact: true })).toBeVisible();
  await expect(page.locator('.point-picker button', { hasText: /^Soojakandja maast/ })).toBeVisible();
});

test('server validates the heat pump link input and never accepts public addresses', async ({ request }) => {
  const headers = { 'X-Soojus-Request': '1', Origin: 'http://localhost:3210' };
  for (const host of ['8.8.8.8', 'localhost', '', '192.168.1.256', 'http://192.168.1.5']) expect((await request.post('/api/luxtronik', { data: { host }, headers })).status(), host).toBe(400);
  expect((await request.post('/api/luxtronik', { data: { host: '192.168.100.171' } })).status()).toBe(403);
  expect((await request.get('/api/history/mix?hours=24&pump=nope&s=l:brine_in')).status()).toBe(200);
  expect((await request.get('/api/history/mix?hours=24&pump=nope&s=p:5,l:brine_in')).status()).toBe(404);
  expect((await request.get('/api/history/mix?hours=24&pump=nope&s=l:brine;in')).status()).toBe(400);
});

test('archive viewer lists files and plots a selected series from the CSV', async ({ page }) => {
  await page.route('**/api/archive/soojus-2024.csv/history**', route => route.fulfill({ json: { rows: [{ point: 'dev|p1', time: '2024-01-01T00:00:00.000Z', value: 90, label: 'Sissepuhke õhuvool', unit: 'm³/h' }, { point: 'dev|p1', time: '2024-01-02T00:00:00.000Z', value: 95, label: 'Sissepuhke õhuvool', unit: 'm³/h' }], count: 2, bucketSeconds: 86400, since: '2024-01-01T00:00:00.000Z', source: 'archive', gaps: [] } }));
  await page.route('**/api/archive/soojus-2024.csv', route => route.fulfill({ json: { name: 'soojus-2024.csv', series: [{ token: 'dev|p1', device: 'dev', point: 'p1', label: 'Sissepuhke õhuvool', unit: 'm³/h', count: 10 }], from: '2024-01-01T00:00:00.000Z', to: '2024-01-10T00:00:00.000Z', rows: 10 } }));
  await page.route('**/api/archive', route => route.fulfill({ json: { files: [{ name: 'soojus-2024.csv', bytes: 2048, modified: '2026-01-01T00:00:00.000Z' }] } }));
  await page.goto('/?page=history');
  await page.getByRole('button', { name: 'Arhiiv' }).click();
  await expect(page.getByLabel('Arhiivifail')).toBeVisible();
  const series = page.getByRole('button', { name: /Sissepuhke õhuvool/ });
  await expect(series).toBeVisible();
  await series.click();
  await expect(series).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
});

test('archive only accepts dates older than a year, exports a file and removes the rows', async ({ request }) => {
  const headers = { 'X-Soojus-Request': '1', Origin: 'http://localhost:3210' };
  const dir = 'data/archive';
  const before = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  try {
    expect((await request.post('/api/archive', { data: {}, headers })).status()).toBe(400);
    expect((await request.post('/api/archive', { data: { before: new Date().toISOString() }, headers })).status()).toBe(400);
    const old = new Date(Date.now() - 400 * 86400000).toISOString();
    const res = await request.post('/api/archive', { data: { before: old }, headers });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(0);
    expect(fs.existsSync(path.join(dir, path.basename(body.file)))).toBe(true);
  } finally {
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (!before.includes(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
});

test('footer and panel tell that the heat pump is read directly with myUplink as the backup', async ({ page }) => {
  const view = { configured: true, host: '192.168.100.171', time: new Date().toISOString(), error: null, primary: true, verified: true, mismatch: false, upstreamProblem: null, mapped: 11, data: { temperatures: { brineIn: 9, brineOut: 6, hotGas: 70 }, inputs: {}, outputs: {} }, points: [] };
  await page.route('**/api/luxtronik', route => route.fulfill({ json: view }));
  await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
  await page.goto('/?page=overview');
  await expect(page.locator('.nx-foot')).toContainText('soojuspump otse kohtvõrgust, myUplink varuks');
  Object.assign(view, { upstreamProblem: 'fetch failed' });
  await page.goto('/?page=settings');
  await expect(page.getByText(/Põhiallikas: pump otse \(11 näitu/)).toBeVisible();
  await expect(page.getByText(/tuleb praegu myUplinkist, otseväärtuse kinnitan pumba järgmisel töötsüklil/)).toBeVisible();
  Object.assign(view, { powerSource: 'acInput' });
  await page.goto('/?page=settings');
  await expect(page.getByText(/loetakse otse pumbalt/)).toBeVisible();
  await page.goto('/?page=overview'); await page.waitForTimeout(500);
  await expect(page.locator('.nx-foot')).toContainText('(praegu ei vasta)');
  Object.assign(view, { primary: false, mismatch: true, upstreamProblem: null });
  await page.goto('/?page=settings');
  await expect(page.getByText(/ei klapi myUplinki omadega/)).toBeVisible();
  await page.goto('/?page=overview');
  await expect(page.locator('.nx-foot')).toContainText('myUplink Public API');
});

test('pump error log lists stored errors and Kodu warns about a recent one', async ({ page }) => {
  const recent = new Date(Date.now() - 3600000).toISOString(), older = new Date(Date.now() - 3 * 86400000).toISOString();
  const view = { configured: true, host: '192.168.100.171', time: new Date().toISOString(), error: null, primary: true, verified: true, mapped: 11, upstreamProblem: null, powerSource: null, errors7d: 6,
    errors: [{ time: recent, code: 765, name: 'Külmaaine ülekuumenemine liiga madal (SSH alla 2 K üle 5 min)' }, { time: older, code: 765, name: 'Külmaaine ülekuumenemine liiga madal (SSH alla 2 K üle 5 min)' }],
    data: { temperatures: { brineIn: 12, brineOut: 11, hotGas: 40 }, inputs: {}, outputs: {} }, points: [] };
  await page.route('**/api/luxtronik', route => route.fulfill({ json: view }));
  await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
  await page.goto('/?page=overview');
  await expect(page.locator('.nx-notes')).toContainText('Pump andis veakoodi 765');
  await expect(page.locator('.nx-notes')).toContainText('Viimase 7 päeva jooksul 6 korda');
  await page.goto('/?page=settings');
  const box = page.locator('.pump-errors');
  await expect(box).toContainText('Pumba veateated'); await expect(box).toContainText('6 viimase 7 päeva jooksul');
  await expect(box.locator('li')).toHaveCount(2); await expect(box.locator('li').first()).toContainText('765');
  view.errors = [{ time: older, code: 765, name: 'x' }];
  await page.goto('/?page=overview'); await page.waitForTimeout(400);
  await expect(page.locator('main')).not.toContainText('Pump andis veakoodi');
});

test('the pump error note on Kodu can be hidden and returns only for a newer error', async ({ page, request }) => {
  const recent = new Date(Date.now() - 3600000).toISOString();
  const view = { configured: true, host: '192.168.100.171', time: new Date().toISOString(), error: null, primary: true, verified: true, mapped: 11, upstreamProblem: null, powerSource: null, errors7d: 2, errorsAck: null,
    errors: [{ time: recent, code: 765, name: 'Külmaaine ülekuumenemine liiga madal' }], data: { temperatures: {}, inputs: {}, outputs: {} }, points: [] };
  let acked = 0;
  await page.route('**/api/luxtronik/errors/ack', route => { acked++; view.errorsAck = view.errors[0].time; route.fulfill({ json: view }); });
  await page.route('**/api/luxtronik', route => route.fulfill({ json: view }));
  await page.addInitScript(() => localStorage.setItem('soojus.ui', 'next'));
  await page.goto('/?page=overview');
  await expect(page.locator('.nx-notes')).toContainText('Pump andis veakoodi 765');
  await page.getByRole('button', { name: /Peida see veateade/ }).click();
  await expect.poll(() => acked).toBe(1);
  await expect(page.locator('main')).not.toContainText('Pump andis veakoodi');
  await page.goto('/?page=settings');
  await expect(page.locator('.pump-errors li')).toHaveCount(1);
  view.errors.unshift({ time: new Date().toISOString(), code: 765, name: 'Külmaaine ülekuumenemine liiga madal' });
  await page.goto('/?page=overview');
  await expect(page.locator('.nx-notes')).toContainText('Pump andis veakoodi 765');
  expect((await request.post('/api/luxtronik/errors/ack', { data: {} })).status()).toBe(403);
});
