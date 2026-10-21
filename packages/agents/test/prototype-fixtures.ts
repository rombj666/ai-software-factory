import type { DesignSpecification } from "../src/prototype-schema";
export const design: DesignSpecification = {
  productOverview: "A private book club reading list", targetUsers: ["Club members"], navigation: "Single reading list screen",
  visualDirection: "Warm, minimal editorial design with indigo controls",
  tokens: { colors: ["primary #4f46e5", "background #f8fafc"], typography: "Readable system sans serif", spacing: "8px grid" },
  screens: [{ id: "reading-list", name: "Reading list", purpose: "Manage the club reading list", layout: "Header, add-book form, table of books", components: ["Header", "Reading table"], controls: ["Add book", "Status filter"], interactions: ["Add a book to the list"], requirementReferences: ["Add books"], navigationTo: [], viewport: "desktop", responsive: "Stack form and turn table into cards on mobile" }],
  assumptions: ["Small private club"], limitations: ["Static visual references are not executable interfaces"],
};
