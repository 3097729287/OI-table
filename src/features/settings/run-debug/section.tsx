import { useMessages } from "../../../i18n";
import { StatusMessage } from "../../../shared/StatusMessage";

export default function RunDebugSection() {
  const messages = useMessages();
  return <StatusMessage state="empty">{messages.settingsGroupEmpty}</StatusMessage>;
}
