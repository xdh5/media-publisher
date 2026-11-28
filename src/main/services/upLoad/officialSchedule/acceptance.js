import fs from "fs";

async function confirmDouyinScheduledItem(page, expectedTitle) {
  const title = String(expectedTitle || "").replace(/\s+/g, "").trim();
  if (!title) return false;

  const manageUrl = "https://creator.douyin.com/creator-micro/content/manage";
  if (!page.url().includes("/content/manage")) {
    await page.goto(manageUrl, { waitUntil: "domcontentloaded", timeout: 0 });
  }

  try {
    await page.waitForFunction((expected) => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      return [...document.querySelectorAll("body *")].some((element) => {
        const text = norm(element.textContent);
        return text === expected;
      });
    }, { timeout: 0 }, title);
    return true;
  } catch {
    return false;
  }
}

export async function waitForOfficialScheduleAccepted(page, platform, previousUrl, expectedTitle = "", publishWindow = null) {
  let verificationShown = false;
  while (!page.isClosed()) {
    if (platform === "抖音" && !verificationShown) {
      const requiresVerification = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes("接收短信验证码") && text.includes("获取验证码");
      }).catch(() => false);
      if (requiresVerification) {
        verificationShown = true;
        if (publishWindow) {
          publishWindow.setOpacity(1);
          publishWindow.setSkipTaskbar(false);
          publishWindow.setFocusable(true);
          publishWindow.show();
          publishWindow.focus();
        }
        const interaction = { platform: "douyin", status: "verification_required", message: "抖音需要短信验证，请在已打开的发布窗口完成验证", updated_at: new Date().toISOString() };
        if (process.env.MEDIA_PUBLISHER_INTERACTION_PATH) {
          fs.writeFileSync(process.env.MEDIA_PUBLISHER_INTERACTION_PATH, JSON.stringify(interaction), "utf8");
        }
        console.log("[auth] " + interaction.message);
      }
    }
    const accepted = await page.evaluate((expectedUrl, platformName) => {
      const currentUrl = location.href;
      if (
        currentUrl !== expectedUrl &&
        (currentUrl.includes("/content/manage") ||
          currentUrl.includes("/article/manage/video") ||
          currentUrl.includes("/manage/content"))
      ) {
        return true;
      }

      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const roots = document.querySelectorAll(
        ".semi-toast, .semi-notification, .ant-message, .ant-notification, .ant-modal, .byte-message, .byte-notification, .cheetah-message, [role='alert']"
      );
      const successWords = ["定时发布成功", "预约成功", "发布成功", "提交成功", "已成功预约"];
      const hasSuccess = [...roots].some((root) => {
        const text = norm(root.textContent);
        return visible(root) && successWords.some((word) => text.includes(word));
      });
      if (hasSuccess) return true;

      if (platformName === "头条" || platformName === "百家号") {
        const errorWords = ["失败", "错误", "重试", "异常", "不可用"];
        const hasError = [...roots].some((root) => {
          const text = norm(root.textContent);
          return visible(root) && errorWords.some((word) => text.includes(word));
        });
        const modal = platformName === "头条"
          ? document.querySelector(".common-timing-picker")
          : document.querySelector(".cheetah-modal-confirm");
        if (!hasError && (!modal || !visible(modal))) return true;
      }
      return false;
    }, previousUrl, platform).catch(() => false);
    if (accepted) {
      if (verificationShown && process.env.MEDIA_PUBLISHER_INTERACTION_PATH) {
        fs.rmSync(process.env.MEDIA_PUBLISHER_INTERACTION_PATH, { force: true });
      }
      return;
    }

    if (
      platform === "抖音" &&
      (page.url().includes("/creator-micro/home") || page.url().includes("/content/manage"))
    ) {
      const confirmed = await confirmDouyinScheduledItem(page, expectedTitle);
      if (confirmed) return;
      throw new Error(`抖音提交后未在作品管理找到对应作品：${expectedTitle || "标题为空"}`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error("发布页面已关闭，停止等待官方预约确认");
}
