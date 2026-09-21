export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.info('WebAble is ready.');
  });
});
