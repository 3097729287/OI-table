import type { WindowOptions } from "../../windowing/routes";
import { Workbench } from "../../workspace/Workbench";

export const windowOptions = {
  title: "OI-table",
} satisfies WindowOptions;

export default function MainWindow() {
  return <Workbench />;
}
