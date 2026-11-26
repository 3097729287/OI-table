import { useId } from "react";
import { version } from "../../../../package.json";
import { useMessages } from "../../../i18n";
import { desktopProjects, frontendProjects } from "./credits";
import "./about.css";

function ProjectsTable({ title, projects }: {
  title: string;
  projects: readonly { name: string; version: string; license: string }[];
}) {
  const messages = useMessages();

  return (
    <table className="settings-about__table" data-selectable>
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">{messages.aboutProject}</th>
          <th scope="col">{messages.aboutVersion}</th>
          <th scope="col">{messages.aboutLicense}</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((project) => (
          <tr key={`${project.name}:${project.version}`}>
            <th scope="row">{project.name}</th>
            <td>{project.version}</td>
            <td>{project.license}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AboutSection() {
  const messages = useMessages();
  const headingId = useId();

  return (
    <div className="settings-about">
      <header className="settings-about__product">
        <h2 data-selectable>OI-table</h2>
        <dl className="settings-about__product-details">
          <div><dt>{messages.aboutVersion}</dt><dd data-selectable>{version}</dd></div>
          <div><dt>{messages.aboutLicense}</dt><dd data-selectable>MIT</dd></div>
        </dl>
      </header>
      <section className="settings-about__credits" aria-labelledby={headingId}>
        <h2 id={headingId}>{messages.aboutThirdParty}</h2>
        <ProjectsTable title={messages.aboutFrontend} projects={frontendProjects} />
        <ProjectsTable title={messages.aboutDesktop} projects={desktopProjects} />
      </section>
    </div>
  );
}
