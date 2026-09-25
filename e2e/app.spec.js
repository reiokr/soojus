import { test, expect } from '@playwright/test';

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
  await expect(page.getByText('Seade on võrgus',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Kodu soojusring'})).toBeVisible();
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  for(const [nav,heading] of [['Küte ja sisekliima','Soojus sinu rütmis.'],['Soe tarbevesi','Soe vesi, just õigel ajal.'],['Ajalugu','Sinu kodu numbrites.'],['Kõik parameetrid','Kõik näidud. Ühes kohas.'],['Teavitused','Hoia süsteemil silm peal.'],['Minu seade','Tunne oma soojuspumpa.'],['Seaded ja ühendus','Kõik ühendused paigas.']]) {
    await page.getByRole('navigation').getByRole('button',{name:nav,exact:true}).click();
    await expect(page.getByRole('heading',{name:heading})).toBeVisible();
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
  await expect(page.locator('.alarm-row')).toHaveCount(3);
  const systems=await(await request.get('/api/systems')).json();const id=systems[0].devices[0].id;
  const history=await(await request.get(`/api/history/${id}?hours=24`)).json();
  expect(history.rows.length).toBeGreaterThan(0);expect(history.source).toBe('local');
  const csv=await request.get(`/api/history/${id}?hours=24&format=csv`);
  expect(csv.headers()['content-type']).toContain('text/csv');expect(await csv.text()).toContain('Aeg;Parameeter;Nimetus;Väärtus;Ühik');
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
  await expect(page.getByText('Seade on võrgus',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Ava menüü'}).click();
  await page.getByRole('navigation').getByRole('button',{name:'Soe tarbevesi',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Soe vesi, just õigel ajal.'})).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('visibility','hidden');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
});
