import { LegalPage } from "./LegalDocument.js";
import terms from "./texts/terms.md?raw";
import privacy from "./texts/privacy.md?raw";
import consent from "./texts/consent.md?raw";
import consentLesson from "./texts/consent-lesson.md?raw";
import requisites from "./texts/requisites.md?raw";

/**
 * Страницы документов. Тексты — `texts/*.md` (черновики и памятки владельца —
 * `docs/legal/`). Согласие на обработку данных оформляется отдельным
 * документом (ч. 1 ст. 9 152-ФЗ в ред. 156-ФЗ от 24.06.2025), поэтому их два:
 * при регистрации и при входе в урок.
 */
export const TermsPage = () => <LegalPage source={terms} />;
export const PrivacyPolicyPage = () => <LegalPage source={privacy} />;
export const ConsentPage = () => <LegalPage source={consent} />;
export const LessonConsentPage = () => <LegalPage source={consentLesson} />;
export const RequisitesPage = () => <LegalPage source={requisites} />;
