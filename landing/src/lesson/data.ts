export type Person = {
  id: string;
  name: string;
  teacher?: boolean;
  self?: boolean;
  hand?: boolean;
  micOff?: boolean;
  weak?: boolean;
  speaking?: boolean;
  video?: "a" | "b" | "c";
};

/** Состав «класса» для макета: учитель + 11 учеников (как в 12-плиточной сетке урока). */
export const PEOPLE: Person[] = [
  { id: "t", name: "Марина Петровна", teacher: true, self: true, video: "b", speaking: true },
  { id: "1", name: "Аня Соколова", video: "a" },
  { id: "2", name: "Илья Крылов", hand: true, micOff: true },
  { id: "3", name: "Соня Ветрова", micOff: true },
  { id: "4", name: "Егор Лапин", video: "c", micOff: true },
  { id: "5", name: "Лиза Орлова", micOff: true },
  { id: "6", name: "Тимур Ганиев", micOff: true, weak: true },
  { id: "7", name: "Даша Миронова", video: "a", micOff: true },
  { id: "8", name: "Кирилл Зуев", micOff: true },
  { id: "9", name: "Настя Беляева", micOff: true },
  { id: "10", name: "Артём Волков", video: "c", micOff: true },
  { id: "11", name: "Полина Ким", micOff: true },
];

export type StudentStatus = "not_started" | "in_progress" | "stuck" | "done";

export type ProgressRow = { name: string; total: number; answered: number; status: StudentStatus };

export const PROGRESS_START: ProgressRow[] = [
  { name: "Аня Соколова", total: 5, answered: 3, status: "in_progress" },
  { name: "Илья Крылов", total: 5, answered: 1, status: "stuck" },
  { name: "Соня Ветрова", total: 5, answered: 4, status: "in_progress" },
  { name: "Егор Лапин", total: 5, answered: 2, status: "in_progress" },
  { name: "Лиза Орлова", total: 5, answered: 0, status: "not_started" },
  { name: "Тимур Ганиев", total: 5, answered: 0, status: "not_started" },
  { name: "Даша Миронова", total: 5, answered: 5, status: "in_progress" },
  { name: "Кирилл Зуев", total: 5, answered: 2, status: "in_progress" },
];

export const CHAT = [
  { who: "Аня Соколова", at: "10:04", body: "А диагонали всегда перпендикулярны?" },
  { who: "Марина Петровна", at: "10:04", body: "Только у ромба и квадрата — смотрим на доску." },
  { who: "Илья Крылов", at: "10:06", body: "Понял, спасибо!" },
];
