import productionIcon from "../app-icon.svg?no-inline";
import developmentIcon from "../app-icon-dev.svg?no-inline";

export const appIcon = import.meta.env.DEV ? developmentIcon : productionIcon;
export const appIconLabel = import.meta.env.DEV ? "Visuales development" : "";

if (import.meta.env.DEV) {
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = developmentIcon;
}
