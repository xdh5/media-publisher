"use strict";

/**
 * 各平台页面地址，供命令行登录和发布使用。
 */
export default {抖音: {
    index: "https://creator.douyin.com/creator-micro/home",
    upload: "https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page",
    useragent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    listIndex: "https://creator.douyin.com/creator-micro/content/manage",
  },
视频号: {
    index: "https://channels.weixin.qq.com/platform",
    upload: "https://channels.weixin.qq.com/platform/post/create",
    useragent:
      "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF",
    listIndex: "https://channels.weixin.qq.com/platform/post/list",
  },
哔哩哔哩: {
    index: "https://member.bilibili.com/platform/home",
    upload: "https://member.bilibili.com/platform/upload/video/frame/",
    useragent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    listIndex: "https://member.bilibili.com/platform/upload-manager/article",
  },
头条: {
    index: "https://mp.toutiao.com/profile_v4/index",
    upload: "https://mp.toutiao.com/profile_v4/xigua/upload-video",
    useragent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    listIndex: "https://mp.toutiao.com/profile_v4/manage/content/all",
  },
快手: {
    index: "https://cp.kuaishou.com/profile",
    upload: "https://cp.kuaishou.com/article/publish/video?tabType=1",
    useragent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    listIndex: "https://cp.kuaishou.com/article/manage/video",
  }};
