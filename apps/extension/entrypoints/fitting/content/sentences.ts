// Original true/false sentences for the reading ladder, written for WebAble at Gator Hack V.
// Each is 54 to 58 characters and 10 to 13 words, with everyday words. Balanced: 30 true, 30 false.
// Never replace these with sentences from published reading charts.

export interface Sentence { text: string; truth: boolean }

export const SENTENCES: readonly Sentence[] = [
  { text: "A cat can climb a tree and sleep on a warm sunny step.", truth: true },
  { text: "Rain falls from gray clouds and helps the garden grow.", truth: true },
  { text: "Most people use a fork and a spoon to eat their dinner.", truth: true },
  { text: "A bird has wings and many birds can fly over the lake.", truth: true },
  { text: "Milk is often kept in the fridge so that it stays cold.", truth: true },
  { text: "The grass is often green in spring after a lot of rain.", truth: true },
  { text: "A clock shows the time with numbers or with two hands.", truth: true },
  { text: "Babies drink milk and they sleep for many hours each day.", truth: true },
  { text: "We wear a coat outside when the day is cold and windy.", truth: true },
  { text: "A train runs on long metal tracks from town to town daily.", truth: true },
  { text: "Bees make honey and live with many other bees together.", truth: true },
  { text: "People brush their teeth to keep them clean and strong.", truth: true },
  { text: "A cow eats grass in the field and can give us fresh milk.", truth: true },
  { text: "Water turns to ice when it gets very cold in the winter.", truth: true },
  { text: "A book has pages full of words that people like to read.", truth: true },
  { text: "The sky is often blue on a sunny day with no clouds above.", truth: true },
  { text: "Apples grow on trees and can be red, green, or yellow.", truth: true },
  { text: "A key can open a door when it fits the lock just right.", truth: true },
  { text: "Most cars have four wheels and a soft seat for the driver.", truth: true },
  { text: "Friends often laugh and talk when they eat lunch together.", truth: true },
  { text: "A boat can float on water and carry people across a lake.", truth: true },
  { text: "Ducks can swim in a pond and walk on the grass nearby.", truth: true },
  { text: "People sleep in a bed and rest their heads on a pillow.", truth: true },
  { text: "A lamp gives us light so we can see when it gets dark.", truth: true },
  { text: "Carrots are vegetables, and many rabbits like to eat them.", truth: true },
  { text: "You can hear music when someone plays a piano or a drum.", truth: true },
  { text: "A hat can keep the hot sun off your face in the summer.", truth: true },
  { text: "Many children learn to read and write when they are young.", truth: true },
  { text: "Leaves can change color and fall to the ground in autumn.", truth: true },
  { text: "A ball is round, and people like to throw it or kick it.", truth: true },
  { text: "A fish can ride a bike to school on a busy Monday morning.", truth: false },
  { text: "Ice is very hot, so people use it to cook eggs for lunch.", truth: false },
  { text: "Cats have six legs and they bark when the mail comes in.", truth: false },
  { text: "The moon is a small green apple that hangs on an old tree.", truth: false },
  { text: "People wear shoes on their heads to walk out in the rain.", truth: false },
  { text: "A car can fly over the clouds and land on a tall cloud.", truth: false },
  { text: "Dogs lay their eggs in nests high up in the tallest trees.", truth: false },
  { text: "You can drink a cup of sand when you are very thirsty.", truth: false },
  { text: "Bread grows on the bottom of the sea next to the fish.", truth: false },
  { text: "A chair has wheels for wings and sings songs at night.", truth: false },
  { text: "The sun is cold and dark and comes out only at midnight.", truth: false },
  { text: "A horse is tiny enough to sleep inside a small cup of tea.", truth: false },
  { text: "Trees walk to the store each day to buy their own milk.", truth: false },
  { text: "A spoon can sing and dance when the music starts to play.", truth: false },
  { text: "Grass is bright purple and it grows on top of the clouds.", truth: false },
  { text: "Birds swim deep under the ground and never see the sky.", truth: false },
  { text: "A clock tells you how much a bag of rice weighs at home.", truth: false },
  { text: "Rocks are soft and people use them as pillows at night.", truth: false },
  { text: "A pencil is used to tie your shoes before you go outside.", truth: false },
  { text: "Fire is cold, and people use it to keep ice cream frozen.", truth: false },
  { text: "Cows can read the paper and drive a bus into the big city.", truth: false },
  { text: "Babies are born knowing how to drive a big red fire truck.", truth: false },
  { text: "The ocean is dry and you can walk across it in an hour.", truth: false },
  { text: "Rabbits have long ears and use them to fly to the moon.", truth: false },
  { text: "Snow is hot, so people use it to warm up their houses.", truth: false },
  { text: "A banana is bright blue and grows inside a hard metal box.", truth: false },
  { text: "Hands have ten toes that we use to walk down the street.", truth: false },
  { text: "A table can run fast and jump over the fence to get away.", truth: false },
  { text: "Socks are made of glass, so they break when you walk home.", truth: false },
  { text: "Your nose is on your foot so you can smell your shoes.", truth: false },
];

/** The paragraph on the comfortable-size screen. It is the thing being sized, so it stays short (38 words). */
export const COMFORT_PARAGRAPH =
  "This is a short note for you to read. Make it larger or smaller until the words feel easy, " +
  "the way a letter from a friend should look. There is no right size, only the one that feels relaxed today.";

/** Common five-letter words for the faint-words screen. */
export const FAINT_WORDS: readonly string[] = [
  "house", "water", "light", "plant", "chair", "bread", "music", "river", "green", "table", "smile", "cloud",
  "train", "apple", "stone", "night", "horse", "paper", "beach", "clock", "sugar", "dream", "fruit", "glass",
];
