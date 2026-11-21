import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WindowOptions } from "../../windowing/routes";

export const windowOptions = {
  title: "OI-table",
} satisfies WindowOptions;

export default function MainWindow() {
  return (
    <main className="workspace">
      <h1>{messages.helloWorld}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </main>
  );
}
