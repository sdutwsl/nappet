const WebSocket = require("ws");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "config.json");
let config = {};
try {
  const configData = fs.readFileSync(configPath);
  config = JSON.parse(configData);
} catch (error) {
  console.error("无法读取配置文件:", error);
  process.exit(1);
}

const pet_url = config.pet_url;
const nap_url = config.nap_url;

async function main() {
  let ws;

  function connectWebSocket() {
    ws = new WebSocket(nap_url);

    ws.on("open", () => {
      console.log("WebSocket 连接已建立");
    });

    ws.on("message", async (data) => {
      const message = JSON.parse(data.toString());
      console.log(message);
      try {
        await handle_pet(message);
        await handle_pet_ins(message);
        await handle_pet_tickle(message);
      } catch (e) {
        console.error(e);
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket 错误:", error);
    });

    ws.on("close", () => {
      console.log("WebSocket 连接已关闭，30秒后重新连接...");
      setTimeout(connectWebSocket, 30000);
    });
  }

  connectWebSocket();

  const pet_data = (await get_pet_data()).petData;

  async function handle_pet_ins(message) {
    if (message.message_type !== "group") {
      return;
    }
    const message_segs = message.message;
    const texts = message_segs.filter((e) => e.type === "text");
    const ats = message_segs.filter((e) => e.type === "at");
    if (texts.length === 0) {
      return;
    }
    const text_params = texts
      .map((e) => e.data.text)
      .join(" ")
      .split(" ");
    const user_instruction = text_params.shift();
    const pet_item = pet_data.find(
      (e) => e.key === user_instruction || e.alias.includes(user_instruction)
    );
    if (!pet_item) {
      return;
    }
    const instruction = pet_item.key;

    //key
    const pet_params = { key: instruction };
    //from avatar, from message sender
    pet_params.from_avatar = format_qq_avatar(message.sender.user_id);
    //to avatar, first at
    if (ats.length) {
      const to = ats.shift();
      pet_params.to_avatar = format_qq_avatar(to.data.qq);
    } else {
      //or same as sender
      pet_params.to_avatar = format_qq_avatar(message.sender.user_id);
    }
    //group avatar, none
    //bot avatar, message's self_id
    pet_params.bot_avatar = format_qq_avatar(message.self_id);
    //ramdom avatar, if there are more user mentions, use them, or undefined
    if (ats.length) {
      pet_params.random_avatar_list = ats
        .map((e) => format_qq_avatar(e.data.qq))
        .join(",");
    }
    //from_name, none
    //to_name, none
    //group_name, none
    //text_list, use message's texts
    pet_params.text_list = text_params.join(" ");

    const raw_image = await get_pet_image(pet_params);
    const reply = {
      action: "send_group_msg",
      params: {
        group_id: message.group_id,
        message: [
          {
            type: "image",
            data: {
              file:
                "base64://" +
                Buffer.from(raw_image, "binary").toString("base64"),
            },
          },
        ],
      },
      echo: "",
    };
    ws.send(JSON.stringify(reply));
  }

  async function handle_pet(message) {
    if (message.message_type === "group" && message.raw_message === "pet") {
      const reply = {
        action: "send_group_msg",
        params: {
          group_id: message.group_id,
          message: [
            {
              type: "text",
              data: {
                text: pet_data
                  .map((e) => `${e.key} (${e.alias.join(" ")})`)
                  .join("\n"),
              },
            },
          ],
        },
        echo: "",
      };
      ws.send(JSON.stringify(reply));
    }
  }

  async function handle_pet_tickle(message) {
    if (message.post_type !== "notice" && message.notice_type !== "notify") {
      return;
    }

    const instruction = pet_data.map((e) => e.key)[
      Math.floor(Math.random() * pet_data.length)
    ];

    //key
    const pet_params = { key: instruction };
    // if tickle bot
    if (message.target_id === message.self_id) {
      //from avatar, from bot
      pet_params.from_avatar = format_qq_avatar(message.self_id);

      //to avatar, the sender
      pet_params.to_avatar = format_qq_avatar(message.user_id);
    } else {
      //from avatar, from sender
      pet_params.from_avatar = format_qq_avatar(message.user_id);

      //to avatar, the target
      pet_params.to_avatar = format_qq_avatar(message.target_id);
    }
    //group avatar, none
    //bot avatar, message's self_id
    pet_params.bot_avatar = format_qq_avatar(message.self_id);
    //ramdom avatar, none
    //from_name, none
    //to_name, none
    //group_name, none
    //text_list, none

    const raw_image = await get_pet_image(pet_params);
    const reply = {
      action: "send_group_msg",
      params: {
        group_id: message.group_id,
        message: [
          {
            type: "image",
            data: {
              file:
                "base64://" +
                Buffer.from(raw_image, "binary").toString("base64"),
            },
          },
        ],
      },
      echo: "",
    };
    ws.send(JSON.stringify(reply));
  }

  function format_qq_avatar(qq) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640`;
  }

  async function get_pet_image(params) {
    const query_string = object_to_query_string(convert_snake_to_camel(params));
    const dest_url = `${pet_url}?${query_string}`;
    console.log(dest_url);
    const res = await axios.get(dest_url, { responseType: "arraybuffer" });
    return res.data;
  }

  function convert_snake_to_camel(obj) {
    const result = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const camelKey = key.replace(/_([a-z])/g, (match, letter) =>
          letter.toUpperCase()
        );
        result[camelKey] = obj[key];
      }
    }

    return result;
  }

  function object_to_query_string(obj) {
    const queryString = Object.entries(obj)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      )
      .join("&");

    return queryString;
  }

  async function get_pet_data() {
    const pet_data = await axios.get(pet_url);
    return pet_data.data;
  }
}

main();
