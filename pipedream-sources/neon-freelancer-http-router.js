const jsonHeaders = {
  "Content-Type": "application/json",
};

export default {
  name: "NEON Freelancer HTTP Router",
  description:
    "Receives NEON webhooks, calls Freelancer with managed OAuth, and returns a synchronous JSON response.",
  key: "neon_freelancer_http_router",
  version: "0.0.1",
  type: "source",
  props: {
    http: {
      type: "$.interface.http",
      customResponse: true,
    },
    freelancer: {
      type: "app",
      app: "freelancer",
    },
    db: "$.service.db",
  },
  methods: {
    getBody(event) {
      if (event?.body && typeof event.body === "object") {
        return event.body;
      }

      if (typeof event?.bodyRaw === "string" && event.bodyRaw.trim()) {
        try {
          return JSON.parse(event.bodyRaw);
        } catch {
          return { rawBody: event.bodyRaw };
        }
      }

      return {};
    },
    async freelancerRequest(path, params = {}) {
      const token = this.freelancer.$auth.oauth_access_token;
      const url = new URL(`https://www.freelancer.com${path}`);

      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      });

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "freelancer-oauth-v1": token,
        },
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      if (!response.ok) {
        const message =
          data?.message ||
          data?.error?.message ||
          `Freelancer API returned HTTP ${response.status}`;

        const error = new Error(message);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    },
    respond(body, status = 200) {
      this.http.respond({
        status,
        headers: jsonHeaders,
        body,
      });

      return body;
    },
    emitTrace(body, responseBody) {
      const eventId = body.eventId || `neon-${Date.now()}`;
      const action = body.action || "unknown";
      const count = Array.isArray(responseBody.projects)
        ? responseBody.projects.length
        : undefined;

      this.$emit(
        {
          request: {
            eventId,
            action,
            userId: body.userId,
            userMessage: body.userMessage,
          },
          response: {
            ok: responseBody.ok,
            action: responseBody.action,
            eventId: responseBody.eventId,
            count,
          },
        },
        {
          id: eventId,
          name: action,
          summary:
            count === undefined
              ? `NEON Freelancer: ${action}`
              : `NEON Freelancer: ${count} projects`,
          ts: Date.now(),
        },
      );
    },
  },
  async run(event) {
    const body = this.getBody(event);

    try {
      let responseBody;

      if (body.action === "webhook_test") {
        const account = await this.freelancerRequest("/api/users/0.1/self/");
        const username =
          account?.result?.username ||
          account?.result?.display_name ||
          account?.result?.public_name ||
          "аккаунт активен";

        responseBody = {
          ok: true,
          action: body.action,
          eventId: body.eventId,
          neonReply: `Freelancer подключен: ${username}`,
          account,
        };
      } else if (
        body.action === "search_jobs" ||
        body.action === "project_intake"
      ) {
        const result = await this.freelancerRequest(
          "/api/projects/0.1/projects/active/",
          {
            query: body.userMessage || "React",
            limit: 10,
            full_description: true,
            job_details: true,
            user_details: true,
            location_details: true,
            upgrade_details: true,
          },
        );

        const projects = result?.result?.projects || result?.projects || [];

        responseBody = {
          ok: true,
          action: body.action,
          eventId: body.eventId,
          query: body.userMessage,
          count: projects.length,
          projects,
          raw: result,
        };
      } else if (body.action === "proposal_draft") {
        responseBody = {
          ok: true,
          action: body.action,
          eventId: body.eventId,
          neonReply:
            body.aiResponse ||
            "Черновик сопроводительного письма подготовлен.",
          draft: body.aiResponse,
          nextStep:
            "Покажи черновик в NEON и отправляй отклик только после подтверждения пользователя.",
        };
      } else {
        responseBody = {
          ok: true,
          action: body.action || "unknown",
          eventId: body.eventId,
          neonReply: `Freelancer получил действие: ${body.action || "unknown"}`,
          received: body,
        };
      }

      this.emitTrace(body, responseBody);
      return this.respond(responseBody);
    } catch (error) {
      const responseBody = {
        ok: false,
        action: body.action,
        eventId: body.eventId,
        neonReply: `Freelancer source вернул ошибку: ${error.message}`,
        error: {
          message: error.message,
          status: error.status,
          data: error.data,
        },
      };

      this.emitTrace(body, responseBody);
      return this.respond(responseBody, 200);
    }
  },
};
