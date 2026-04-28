import { axios } from "@pipedream/platform";

export default {
  name: "NEON Freelancer Router Response",
  description:
    "Routes NEON webhook actions to Freelancer API and returns a synchronous HTTP response back to NEON.",
  key: "neon_freelancer_router_response",
  version: "0.0.1",
  type: "action",
  props: {
    freelancer: {
      type: "app",
      app: "freelancer",
    },
  },
  async run({ steps, $ }) {
    const body = steps.trigger?.event?.body || {};
    const token = this.freelancer.$auth.oauth_access_token;

    const request = (options) =>
      axios($, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "freelancer-oauth-v1": token,
          ...(options.headers || {}),
        },
      });

    const respond = async (responseBody, status = 200) => {
      if (typeof $.respond === "function") {
        await $.respond({
          status,
          headers: {
            "Content-Type": "application/json",
          },
          body: responseBody,
        });
      }

      return responseBody;
    };

    try {
      if (body.action === "webhook_test") {
        const account = await request({
          url: "https://www.freelancer.com/api/users/0.1/self/",
        });

        const username =
          account?.result?.username ||
          account?.result?.display_name ||
          account?.result?.public_name ||
          "аккаунт активен";

        return respond({
          ok: true,
          action: body.action,
          eventId: body.eventId,
          neonReply: `Freelancer подключен: ${username}`,
          account,
        });
      }

      if (body.action === "search_jobs" || body.action === "project_intake") {
        const result = await request({
          url: "https://www.freelancer.com/api/projects/0.1/projects/active/",
          params: {
            query: body.userMessage || "React",
            limit: 10,
            full_description: true,
            job_details: true,
            user_details: true,
            location_details: true,
            upgrade_details: true,
          },
        });

        const projects = result?.result?.projects || result?.projects || [];

        return respond({
          ok: true,
          action: body.action,
          eventId: body.eventId,
          query: body.userMessage,
          count: projects.length,
          projects,
          raw: result,
        });
      }

      if (body.action === "proposal_draft") {
        return respond({
          ok: true,
          action: body.action,
          eventId: body.eventId,
          neonReply: body.aiResponse || "Черновик сопроводительного письма подготовлен.",
          draft: body.aiResponse,
          nextStep:
            "Покажи черновик в NEON и отправляй отклик только после подтверждения пользователя.",
        });
      }

      return respond({
        ok: true,
        action: body.action || "unknown",
        eventId: body.eventId,
        neonReply: `Freelancer получил действие: ${body.action || "unknown"}`,
        received: body,
      });
    } catch (error) {
      return respond({
        ok: false,
        action: body.action,
        eventId: body.eventId,
        neonReply: `Freelancer workflow вернул ошибку: ${error.message}`,
        error: {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        },
      });
    }
  },
};
