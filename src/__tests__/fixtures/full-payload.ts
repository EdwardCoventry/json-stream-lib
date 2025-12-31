export const fullPayload = {
  title: "Valid json but totally meaningless data payload",
  description:
    "This payload is structurally valid JSON but the data is just made up nonsense devoid of meaning.",
  rgb: { red: "#ff0000", green: "#00ff00", blue: "#0000ff" },
  bw: { black: "#000000", white: "#ffffff" },
  items_in_json: 16,
  negative_integer: -17,
  floating_point: 3.14159,
  large_number: 1.2e30,
  small_number: 5.67e-25,
  empty_array: [],
  non_empty_array: ["item_one", 102, { nested: "item_3" }],
  empty_object: {},
  deeper_object: {
    level_1: {
      level_2: {
        level_3: {
          key: "deep_value",
        },
      },
    },
  },
  is_valid_json: true,
  is_sensible_data: false,
  meaning: null,
};
