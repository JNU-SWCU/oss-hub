SELECT
  (SELECT count(*) FROM "ApplicationPreparation") +
  (SELECT count(*) FROM "ApplicationPreparationParticipant");
