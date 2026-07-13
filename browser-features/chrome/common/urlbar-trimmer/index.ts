// browser-features/chrome/common/urlbar-trimmer/index.ts
import { noraComponent, NoraComponentBase } from "#features-chrome/utils/base";

@noraComponent(import.meta.hot)
export default class UrlbarTrimmer extends NoraComponentBase {
  init() {
    this.patchUrlBar();
  }

  patchUrlBar() {
    const win = window as any;

    if (win.gURLBar && !win.gURLBar._patchedForQueryHide) {
      win.gURLBar._patchedForQueryHide = true;

      const originalFormatValue = win.gURLBar.formatValue;

      win.gURLBar.formatValue = function (...args: any[]) {
        originalFormatValue.apply(this, args);

        if (!this.focused) {
          const val = this.inputField.value;
          const queryIndex = val.indexOf("?");

          if (queryIndex !== -1) {
            this.inputField.value = val.substring(0, queryIndex);
          }
        }
      };
    }
  }
}