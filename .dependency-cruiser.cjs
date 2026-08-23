/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Циклические зависимости между модулями запрещены (§4.1.1 ТЗ).",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-cross-module-internals",
      severity: "error",
      comment:
        "Модуль импортирует у чужого модуля только его service.ts. repo.ts, routes.ts и таблицы схемы чужого модуля — недоступны напрямую (§4.1.1 ТЗ).",
      from: { path: "^apps/api/src/modules/([^/]+)/" },
      to: {
        path: "^apps/api/src/modules/[^/]+/(?!service\\.ts$).+\\.(ts|tsx)$",
        pathNot: [
          "^apps/api/src/modules/$1/",
          "^apps/api/src/modules/[^/]+/service\\.ts$",
        ],
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Файл ни от кого не зависит и на него никто не ссылается — вероятно, мёртвый код.",
      from: { orphan: true, pathNot: ["\\.test\\.(ts|tsx)$", "\\.d\\.ts$", "main\\.tsx$", "server\\.ts$"] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
