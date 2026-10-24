// Trilium 0.106.1: keep its native tab layout, scrolling and drag behavior.
const tabs = glob.getComponentByEl(document.querySelector('.tab-row-widget'));
if (!Object.hasOwn(tabs, 'tabWidths')) {
    const widths = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(tabs), 'tabWidths').get;
    Object.defineProperty(tabs, 'tabWidths', {
        get() { return widths.call(this).map(width => Math.min(180, width)); }
    });
}
tabs.layoutTabs();
