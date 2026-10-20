import type { PlannerResponse, RequirementsSummary } from "../src/schema";
export const summary: RequirementsSummary = {
  productName: "Reading room",
  description: "A private reading list for a local book club.",
  targetUsers: ["Club members"],
  productGoals: ["Choose and track books"],
  requiredFunctionality: ["Add books", "Mark a book as read"],
  optionalFunctionality: ["Recommendations"],
  authentication: "Club members sign in; organizer manages membership.",
  dataRequirements: "Books, members and reading progress saved privately.",
  designPreferences: "A calm, accessible interface with a light theme.",
  preferredTechnologies: ["Python desktop"],
  mvpSupportNotes:
    "The user's Python desktop preference is retained. The current prototype MVP supports Next.js web prototypes; future feasibility must be discussed.",
  intendedUsage: "local",
  openQuestions: [],
  assumptions: ["One book club initially"],
};
export const ready: PlannerResponse = {
  message: "Your requirements are ready to review.",
  questions: [],
  readyToComplete: true,
  summary,
};
export const question: PlannerResponse = {
  message: "Let's clarify how your club works.",
  questions: ["Who should be able to add books?"],
  readyToComplete: false,
  summary: null,
};
