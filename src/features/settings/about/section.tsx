import { useId } from "react";
import { version } from "../../../../package.json";
import { t } from "../../../i18n";
import { desktopProjects, frontendProjects } from "./credits";
import "./about.css";

function ProjectsTable({ title, projects }: {
  title: string;
  projects: readonly { name: string; version: string; license: string }[];
}) {

  return (
    <table className="settings-about__table" data-selectable>
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">{t("aboutProject")}</th>
          <th scope="col">{t("aboutVersion")}</th>
          <th scope="col">{t("aboutLicense")}</th>
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
  const headingId = useId();

  return (
    <div className="settings-about">
      <header className="settings-about__product">
        <h2 data-selectable>OI-table</h2>
        <dl className="settings-about__product-details">
          <div><dt>{t("aboutVersion")}</dt><dd data-selectable>{version}</dd></div>
          <div><dt>{t("aboutLicense")}</dt><dd data-selectable>MIT</dd></div>
        </dl>
      </header>
      <section className="settings-about__credits" aria-labelledby={headingId}>
        <h2 id={headingId}>{t("aboutThirdParty")}</h2>
        <ProjectsTable title={t("aboutFrontend")} projects={frontendProjects} />
        <ProjectsTable title={t("aboutDesktop")} projects={desktopProjects} />
      </section>
    </div>
  );
}
