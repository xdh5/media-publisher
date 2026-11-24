import path from 'path';
import { clickToutiaoText } from './ttText.js';

export async function uploadToutiaoVideoCover(page, filename) {
  await clickToutiaoText(page, '本地上传');
  const input = await page.waitForSelector('input[type=file][accept^="image/"]', { timeout: 15000 });
  await input.uploadFile(path.resolve(filename));
  await page.waitForSelector('.btn-sure', { visible: true, timeout: 60000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('img[src^="blob:"]');
    return image?.complete && image.naturalWidth > 0;
  }, { timeout: 60000, polling: 250 });
  await page.$eval('.btn-sure', element => element.click());
  const confirm = '.Dialog-container .footer .m-button.red';
  await page.waitForSelector(confirm, { visible: true, timeout: 15000 });
  await page.$eval(confirm, element => element.click());
  await page.waitForFunction(() => ![...document.querySelectorAll('.btn-sure')].some(element => element.getBoundingClientRect().width > 0), { timeout: 60000, polling: 250 });
  await page.waitForFunction(() => [...document.querySelectorAll('div,span,a')].some(element => element.textContent.trim() === '替换' && element.getBoundingClientRect().width > 0), { timeout: 15000, polling: 250 });
}
